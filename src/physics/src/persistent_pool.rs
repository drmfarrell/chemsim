//! Lock-free persistent worker pool.
//!
//! Rayon's `par_iter` pays ~1–2 ms per dispatch on wasm because its workers
//! sleep on `Atomics.wait` between calls and have to be woken with
//! `Atomics.notify` each time. For a tight physics loop that dispatches
//! forces once per step (~hundreds of times per second), that overhead
//! dominates the actual compute. This module spawns a small pool of worker
//! threads that spin-wait on a shared atomic sequence counter instead, so
//! dispatch latency drops to "cache line invalidation" speed.
//!
//! Trade-off: workers burn ~100% CPU when the sim is idle. Fine for a
//! continuously-running simulation, not fine if you want the tab to idle.
//! Callers can stop the pool via [`PersistentPool::shutdown`] when the
//! physics loop pauses.
//!
//! # Protocol
//!
//! A "work batch" is a `(work_fn, work_data)` pair plus an `n_workers`
//! arbitrary chunking into worker IDs. `work_fn` is called once on each
//! worker with `(data, worker_id)`. All workers call it concurrently; it
//! is the caller's responsibility to make sure the writes each worker
//! performs don't alias.
//!
//! Dispatch sequence (main thread):
//!   1. Park `work_data` + `work_fn` in shared state.
//!   2. Reset `done_count` to zero.
//!   3. Bump `seq` (release fence) — this is the signal workers watch.
//!   4. Spin on `done_count == n_workers` (acquire loads).
//!
//! Worker loop:
//!   1. Spin on `seq > my_last_seen` (acquire loads).
//!   2. Read `work_fn` + `work_data` (acquire loads).
//!   3. Execute `work_fn(work_data, my_id)`.
//!   4. `done_count.fetch_add(1)` (release).
//!   5. Update `my_last_seen = seq`.

use std::cell::RefCell;
use std::sync::atomic::{AtomicBool, AtomicPtr, AtomicU64, Ordering};
use std::sync::Arc;
use wasm_bindgen::prelude::*;

/// Callback signature workers execute. `data` is a type-erased pointer to
/// whatever the caller parked in shared state; it must remain valid for the
/// duration of the dispatch (i.e. until `done_count == n_workers`). `id` is
/// the zero-based worker index.
pub type WorkFn = unsafe fn(data: *const u8, id: usize);

struct PoolState {
    /// Bumped by the main thread each time it dispatches a new batch.
    seq: AtomicU64,
    /// Incremented by each worker once it finishes the current batch.
    done_count: AtomicU64,
    /// Incremented by each worker when it enters its spin loop. The pool
    /// constructor spin-waits for this to reach `n_workers` so callers
    /// never dispatch work to workers that haven't started yet.
    ready_count: AtomicU64,
    /// Incremented by each worker when it exits. Shutdown spin-waits for
    /// this to reach `n_workers` before returning so the `Arc<PoolState>`
    /// isn't dropped while workers still hold it.
    exit_count: AtomicU64,
    /// Current work function pointer (thin pointer, 4 bytes on wasm32).
    work_fn: AtomicPtr<()>,
    /// Opaque data pointer handed to each worker.
    work_data: AtomicPtr<u8>,
    /// Number of workers in this pool.
    n_workers: usize,
    /// Flips to `true` when the pool is shutting down; workers exit their
    /// spin loop on the next iteration.
    shutdown: AtomicBool,
}

pub struct PersistentPool {
    state: Arc<PoolState>,
    // We spawn workers through `rayon::spawn` — it occupies rayon's
    // permanent worker threads, which wasm-bindgen-rayon has already wired
    // up as Web Workers. `std::thread::spawn` doesn't have equivalent glue
    // on wasm and traps with "unreachable". No join handles; workers exit
    // when `state.shutdown` flips.
}

impl PersistentPool {
    /// Park `n_workers` infinite-loop tasks on rayon's thread pool. They
    /// immediately enter their spin loop and burn CPU until a batch is
    /// dispatched or [`Self::shutdown`] is called.
    ///
    /// NOTE: these tasks *occupy* rayon's workers, so do not use rayon's
    /// `par_iter` / `scope` / `broadcast` while this pool is alive — the
    /// rayon scheduler would deadlock trying to schedule another job on a
    /// worker that's busy spinning.
    pub fn new(n_workers: usize) -> Self {
        let state = Arc::new(PoolState {
            seq: AtomicU64::new(0),
            done_count: AtomicU64::new(0),
            ready_count: AtomicU64::new(0),
            exit_count: AtomicU64::new(0),
            work_fn: AtomicPtr::new(std::ptr::null_mut()),
            work_data: AtomicPtr::new(std::ptr::null_mut()),
            n_workers,
            shutdown: AtomicBool::new(false),
        });
        for id in 0..n_workers {
            let st = Arc::clone(&state);
            rayon::spawn(move || worker_loop(id, st));
        }
        // Wait until every worker has actually entered its spin loop so the
        // caller's first dispatch doesn't hang waiting for a worker that
        // rayon hasn't scheduled yet.
        while state.ready_count.load(Ordering::Acquire) < n_workers as u64 {
            std::hint::spin_loop();
        }
        Self { state }
    }

    /// Dispatch a batch and block until every worker reports done.
    ///
    /// # Safety
    ///
    /// Callers must ensure:
    /// - `work_fn` is a valid function pointer with the `WorkFn` signature.
    /// - `work_data` remains live and correctly typed for the duration of
    ///   the call (i.e. until this function returns).
    /// - The writes `work_fn` makes do not alias across worker ids.
    pub unsafe fn dispatch(&self, work_fn: WorkFn, work_data: *const u8) {
        let st = &*self.state;
        // Reset done_count *before* we expose new work; workers bumping it
        // later must be counting against this batch, not a stale one.
        st.done_count.store(0, Ordering::Release);
        st.work_data.store(work_data as *mut u8, Ordering::Release);
        st.work_fn.store(work_fn as *mut (), Ordering::Release);
        // The seq bump is the signal. Release ordering pairs with workers'
        // acquire load so they see the work_fn/work_data writes above.
        st.seq.fetch_add(1, Ordering::Release);

        let target = st.n_workers as u64;
        // Spin-wait for every worker to finish. No Atomics.wait — the
        // cache-line bounce is ~tens of nanoseconds, which is exactly why
        // this pool exists.
        while st.done_count.load(Ordering::Acquire) != target {
            std::hint::spin_loop();
        }
    }

    /// Number of worker threads this pool is driving.
    pub fn n_workers(&self) -> usize {
        self.state.n_workers
    }

    /// Signal workers to exit their loops and block until they all actually
    /// return so the `Arc<PoolState>` isn't dropped while workers still
    /// dereference it.
    pub fn shutdown(self) {
        self.state.shutdown.store(true, Ordering::Release);
        // Bump seq so workers exit their inner spin and see the shutdown flag.
        self.state.seq.fetch_add(1, Ordering::Release);
        let n = self.state.n_workers as u64;
        while self.state.exit_count.load(Ordering::Acquire) < n {
            std::hint::spin_loop();
        }
    }
}

// -----------------------------------------------------------------------
// Global singleton + wasm_bindgen wrappers
// -----------------------------------------------------------------------
//
// All wasm calls land on the main thread, so a `thread_local` suffices.
// The pool itself is `Send + !Sync`; workers talk to it only via the
// `Arc<PoolState>` they cloned at construction time.

thread_local! {
    static POOL: RefCell<Option<PersistentPool>> = RefCell::new(None);
}

/// Spin up `n_workers` spin-waiting workers. Must be called *after*
/// `initThreadPool` so the wasm-bindgen thread-spawning machinery is ready.
#[wasm_bindgen]
pub fn init_persistent_pool(n_workers: usize) {
    POOL.with(|slot| {
        let mut slot = slot.borrow_mut();
        if slot.is_some() {
            // Already initialized; leave it alone.
            return;
        }
        *slot = Some(PersistentPool::new(n_workers));
    });
}

/// Returns `true` once `init_persistent_pool` has completed.
#[wasm_bindgen]
pub fn persistent_pool_ready() -> bool {
    POOL.with(|slot| slot.borrow().is_some())
}

/// Ping the pool with a trivial no-op dispatch repeated `n_iters` times,
/// returning total elapsed ms. This measures the lower bound on dispatch
/// latency (cache-line bounce + spin-wait turnaround) so we can compare to
/// rayon's ~1–2 ms per `par_iter` overhead. Cheap enough that we leave it
/// in production builds — main.ts's `__chemsim.benchPoolDispatch` hook
/// calls it for live diagnostics.
#[wasm_bindgen]
pub fn bench_pool_dispatch(n_iters: u32) -> f64 {
    POOL.with(|slot| {
        let slot = slot.borrow();
        let pool = match slot.as_ref() {
            Some(p) => p,
            None => return 0.0,
        };
        unsafe extern "Rust" fn noop(_data: *const u8, _id: usize) {}
        let t0 = js_sys::Date::now();
        for _ in 0..n_iters {
            unsafe { pool.dispatch(noop, std::ptr::null()) };
        }
        js_sys::Date::now() - t0
    })
}

/// Shut down the pool (workers exit, threads join). Safe no-op if the pool
/// was never initialized.
#[wasm_bindgen]
pub fn shutdown_persistent_pool() {
    POOL.with(|slot| {
        if let Some(pool) = slot.borrow_mut().take() {
            pool.shutdown();
        }
    });
}

/// Swap the active pool for one with a different worker count. Blocks
/// until the new pool is fully ready, so callers can dispatch immediately
/// afterwards without a race window.
#[wasm_bindgen]
pub fn set_persistent_pool_workers(n_workers: usize) {
    // Tear down first so the Arc<PoolState> drops cleanly before we spawn
    // the new set of rayon tasks.
    POOL.with(|slot| {
        if let Some(pool) = slot.borrow_mut().take() {
            pool.shutdown();
        }
    });
    let n = n_workers.max(1);
    POOL.with(|slot| {
        *slot.borrow_mut() = Some(PersistentPool::new(n));
    });
}

/// Number of workers in the currently-active pool. Zero if none.
#[wasm_bindgen]
pub fn persistent_pool_worker_count() -> usize {
    POOL.with(|slot| slot.borrow().as_ref().map(|p| p.n_workers()).unwrap_or(0))
}

/// Run `work_fn` on all workers once and block until every worker reports
/// done. Intended for internal callers inside this crate — not wasm-exposed.
///
/// # Safety
///
/// Same invariants as [`PersistentPool::dispatch`]: `data` must remain live
/// until this returns and `work_fn` must be callable with the provided
/// `data` pointer by each worker concurrently without aliasing issues.
pub unsafe fn dispatch_global(work_fn: WorkFn, data: *const u8) -> bool {
    POOL.with(|slot| {
        let slot = slot.borrow();
        let pool = match slot.as_ref() {
            Some(p) => p,
            None => return false,
        };
        pool.dispatch(work_fn, data);
        true
    })
}

/// Returns `n_workers` of the active pool (for partitioning work). Zero if
/// the pool hasn't been initialized.
pub fn pool_worker_count() -> usize {
    POOL.with(|slot| slot.borrow().as_ref().map(|p| p.n_workers()).unwrap_or(0))
}

fn worker_loop(id: usize, state: Arc<PoolState>) {
    // Signal readiness so `PersistentPool::new` knows it's safe to return.
    state.ready_count.fetch_add(1, Ordering::Release);
    let mut last_seen: u64 = 0;
    loop {
        // Spin until main thread bumps the sequence counter.
        let mut cur = state.seq.load(Ordering::Acquire);
        while cur == last_seen {
            if state.shutdown.load(Ordering::Acquire) {
                state.exit_count.fetch_add(1, Ordering::Release);
                return;
            }
            std::hint::spin_loop();
            cur = state.seq.load(Ordering::Acquire);
        }
        last_seen = cur;

        if state.shutdown.load(Ordering::Acquire) {
            state.exit_count.fetch_add(1, Ordering::Release);
            return;
        }

        // Read the current work descriptor. Acquire ordering pairs with the
        // releasing store in `dispatch`, so both fields are guaranteed to be
        // the ones belonging to this sequence.
        let work_fn_raw = state.work_fn.load(Ordering::Acquire);
        let work_data_raw = state.work_data.load(Ordering::Acquire);
        if !work_fn_raw.is_null() {
            let work_fn: WorkFn = unsafe { std::mem::transmute(work_fn_raw) };
            // SAFETY: the caller of `dispatch` promises `work_data` is live
            // and correctly typed until `done_count` reaches `n_workers`.
            unsafe { work_fn(work_data_raw as *const u8, id) };
        }

        state.done_count.fetch_add(1, Ordering::Release);
    }
}
