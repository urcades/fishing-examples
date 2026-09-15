//! JSON and WebAssembly host boundary for the fishing examples.
use fishing_protocol::*;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// JSON transport shared by the native CLI and the minimal WASM adapter.
/// This is a host boundary; the typed functions above remain ordinary Rust.
#[derive(Debug, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
enum Request {
    Config {
        config: Config,
    },
    Create {
        config: Config,
        seed: u32,
    },
    Step {
        state: State,
        input: Input,
        config: Config,
    },
    Observe {
        state: State,
        config: Config,
    },
    Resolve {
        definition: Definition,
        loadout: Loadout,
        seed: u32,
    },
    Select {
        pool: Vec<Fish>,
        bait: Bait,
        seed: u32,
    },
    Random {
        seed: u32,
    },
    Capture {
        capture: geometry::Capture,
        fish: [f64; 2],
        tackle: [f64; 2],
        size: f64,
        radius: f64,
    },
    ValidateState {
        state: State,
        config: Config,
    },
}
fn value<T: Serialize>(v: T) -> Result<Value> {
    serde_json::to_value(v).map_err(|e| e.to_string())
}
fn dispatch(r: Request) -> Result<Value> {
    match r {
        Request::Config { config } => {
            config.validate()?;
            value(config)
        }
        Request::Create { config, seed } => value(create_state(seed, &config)?),
        Request::Step {
            state,
            input,
            config,
        } => value(step(&state, input, &config)?),
        Request::Observe { state, config } => value(observe(&state, &config)?),
        Request::Resolve {
            definition,
            loadout,
            seed,
        } => value(resolve(&definition, &loadout, seed)?),
        Request::Select { pool, bait, seed } => value(select(&pool, &bait, seed)?),
        Request::Random { seed } => {
            let (rng, r) = random(seed);
            value(serde_json::json!({"rng":rng,"value":r}))
        }
        Request::Capture {
            capture,
            fish,
            tackle,
            size,
            radius,
        } => {
            geometry::validate_capture(&capture)?;
            bounded(size, 0.12, 0.45, "size")?;
            bounded(radius, 0.001, 0.1, "radius")?;
            for v in fish.into_iter().chain(tackle) {
                bounded(v, 0.0, 1.0, "coordinate")?;
            }
            value(geometry::alignment(&capture, fish, tackle, size, radius))
        }
        Request::ValidateState { state, config } => {
            config.validate()?;
            state.validate(&config)?;
            value(state)
        }
    }
}
fn bounded(value: f64, min: f64, max: f64, name: &str) -> Result<()> {
    if value.is_finite() && (min..=max).contains(&value) {
        Ok(())
    } else {
        Err(format!("{name} must be finite and between {min} and {max}"))
    }
}

pub const MAX_REQUEST_BYTES: usize = 65536;
pub fn call_json(bytes: &[u8]) -> Vec<u8> {
    let result = if bytes.len() > MAX_REQUEST_BYTES {
        Err("request exceeds 64 KiB".into())
    } else {
        serde_json::from_slice::<Request>(bytes)
            .map_err(|e| e.to_string())
            .and_then(dispatch)
    };
    let response = match result {
        Ok(v) => serde_json::json!({"ok":v}),
        Err(e) => serde_json::json!({"error":e}),
    };
    serde_json::to_vec(&response).expect("finite validated results serialize")
}

// WASM ownership boundary: JS allocates input, calls, then frees both buffers.
// Allocation metadata is not gameplay state. No imports or host callbacks.
#[cfg(target_arch = "wasm32")]
#[no_mangle]
pub extern "C" fn fishing_alloc(len: usize) -> *mut u8 {
    if len > MAX_REQUEST_BYTES {
        return std::ptr::null_mut();
    }
    let bytes = vec![0u8; len].into_boxed_slice();
    Box::into_raw(bytes) as *mut u8
}
/// # Safety
/// `ptr,len` must denote one live allocation returned by this module.
#[cfg(target_arch = "wasm32")]
#[no_mangle]
pub unsafe extern "C" fn fishing_free(ptr: *mut u8, len: usize) {
    if !ptr.is_null() {
        drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len)));
    }
}
/// # Safety
/// `ptr,len` must denote the live input buffer returned by `fishing_alloc`.
/// Result packs output length in high 32 bits and output pointer in low bits.
#[cfg(target_arch = "wasm32")]
#[no_mangle]
pub unsafe extern "C" fn fishing_call(ptr: *const u8, len: usize) -> u64 {
    let result = call_json(std::slice::from_raw_parts(ptr, len)).into_boxed_slice();
    let length = result.len();
    let pointer = Box::into_raw(result) as *mut u8 as u32;
    ((length as u64) << 32) | pointer as u64
}
