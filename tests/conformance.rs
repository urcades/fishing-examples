use fishing::*;
use fishing_examples::{call_json, MAX_REQUEST_BYTES};
use serde_json::Value;
fn close(a: &Value, b: &Value, path: &str) {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => assert!(
            (x.as_f64().unwrap() - y.as_f64().unwrap()).abs() <= 1e-12,
            "{path}: {x} != {y}"
        ),
        (Value::Object(x), Value::Object(y)) => {
            assert_eq!(x.len(), y.len(), "{path}: key count");
            for (k, v) in x {
                close(
                    v,
                    y.get(k).unwrap_or_else(|| panic!("{path}: missing {k}")),
                    &format!("{path}.{k}"),
                );
            }
        }
        (Value::Array(x), Value::Array(y)) => {
            assert_eq!(x.len(), y.len(), "{path}");
            for (i, (v, w)) in x.iter().zip(y).enumerate() {
                close(v, w, &format!("{path}[{i}]"));
            }
        }
        _ => assert_eq!(a, b, "{path}"),
    }
}
fn wire<T: serde::Serialize>(v: T) -> Value {
    serde_json::to_value(v).unwrap()
}
#[test]
fn accepted_demo_trajectories_and_all_events() {
    let fixture: Value =
        serde_json::from_str(include_str!("../conformance/fixtures/trajectories.json")).unwrap();
    for case in fixture["traces"].as_array().unwrap() {
        let config: Config = serde_json::from_value(case["config"].clone()).unwrap();
        let mut state = create_state(case["seed"].as_u64().unwrap() as u32, &config).unwrap();
        let checkpoints = case["checkpoints"].as_array().unwrap();
        close(
            &wire(&state),
            &checkpoints[0]["state"],
            case["id"].as_str().unwrap(),
        );
        for (i, input) in case["inputs"].as_array().unwrap().iter().enumerate() {
            let before = state.clone();
            let r = step(
                &state,
                serde_json::from_value(input.clone()).unwrap(),
                &config,
            )
            .unwrap();
            assert_eq!(state, before);
            r.state.validate(&config).unwrap();
            if let Some(c) = checkpoints
                .iter()
                .find(|c| c["at"].as_u64() == Some(i as u64 + 1))
            {
                close(
                    &wire(&r.state),
                    &c["state"],
                    &format!("{} tick {}", case["id"], i + 1),
                );
                assert_eq!(wire(&r.events), c["events"]);
                // Every stored checkpoint is a valid resumable JSON snapshot.
                let resumed: State = serde_json::from_value(wire(&r.state)).unwrap();
                assert_eq!(resumed, r.state);
            } else {
                assert!(
                    r.events.is_empty(),
                    "unexpected event in {} at {}",
                    case["id"],
                    i + 1
                );
            }
            state = r.state;
        }
        assert!(state.is_terminal());
    }
}
#[test]
fn threshold_expiry_boundary_and_terminal_fixtures() {
    let fixture: Value =
        serde_json::from_str(include_str!("../conformance/fixtures/trajectories.json")).unwrap();
    for case in fixture["steps"].as_array().unwrap() {
        let config: Config = serde_json::from_value(case["config"].clone()).unwrap();
        let state: State = serde_json::from_value(case["state"].clone()).unwrap();
        let result = step(
            &state,
            serde_json::from_value(case["input"].clone()).unwrap(),
            &config,
        )
        .unwrap();
        close(
            &wire(result),
            &case["expected"],
            case["id"].as_str().unwrap(),
        );
    }
}
#[test]
fn canonical_polygon_fixtures() {
    let fixture: Value =
        serde_json::from_str(include_str!("../conformance/fixtures/geometry.json")).unwrap();
    for c in fixture.as_array().unwrap() {
        let shape: geometry::Capture = serde_json::from_value(c["capture"].clone()).unwrap();
        geometry::validate_capture(&shape).unwrap();
        let n = |k: &str| c[k].as_f64().unwrap();
        let q = geometry::alignment(
            &shape,
            [n("fishX"), n("fishY")],
            [n("tackleX"), n("tackleY")],
            n("size"),
            n("radius"),
        );
        close(&wire(q), &c["expected"], c["id"].as_str().unwrap());
    }
}
#[test]
fn invalid_wire_and_configuration_fail_closed() {
    for request in [br#"{"op":"config","config":{"mode":"tracking","dimensions":3,"capture":{"kind":"rectangle"}}}"#.as_slice(),br#"{"op":"create","config":{"mode":"hook","dimensions":0,"capture":{"kind":"rectangle"}},"seed":-1}"#,br#"{"op":"random","seed":1,"secretBuff":10}"#]{
        let r:Value=serde_json::from_slice(&call_json(request)).unwrap();assert!(r.get("error").is_some(),"{r}");
    }
    let r: Value = serde_json::from_slice(&call_json(&vec![b' '; MAX_REQUEST_BYTES + 1])).unwrap();
    assert!(r.get("error").is_some());
}
#[test]
fn reject_invalid_geometry_instead_of_guessing_fill_rules() {
    use geometry::Capture::Polygon;
    for rings in [
        vec![vec![[0.0, 0.0], [1.0, 1.0], [0.0, 1.0], [1.0, 0.0]]],
        vec![
            vec![[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]],
            vec![[0.0, 0.0], [0.5, 0.0], [0.5, 0.5]],
        ],
    ] {
        assert!(geometry::validate_capture(&Polygon { rings }).is_err());
    }
}
#[test]
fn profile_resolution_and_weighted_selection_fixtures() {
    let fixture: Value =
        serde_json::from_str(include_str!("../conformance/fixtures/resolution.json")).unwrap();
    for c in fixture["resolve"].as_array().unwrap() {
        let d: Definition = serde_json::from_value(c["definition"].clone()).unwrap();
        let l: Loadout = serde_json::from_value(c["loadout"].clone()).unwrap();
        close(
            &wire(resolve(&d, &l, c["seed"].as_u64().unwrap() as u32).unwrap()),
            &c["expected"],
            c["id"].as_str().unwrap(),
        );
    }
    for c in fixture["select"].as_array().unwrap() {
        let pool: Vec<Fish> = serde_json::from_value(c["pool"].clone()).unwrap();
        let bait: Bait = serde_json::from_value(c["bait"].clone()).unwrap();
        close(
            &wire(select(&pool, &bait, c["seed"].as_u64().unwrap() as u32).unwrap()),
            &c["expected"],
            c["id"].as_str().unwrap(),
        );
    }
}
#[test]
fn invalid_imports_match_shared_rejection_fixtures() {
    let cases: Value =
        serde_json::from_str(include_str!("../conformance/fixtures/invalid.json")).unwrap();
    for c in cases.as_array().unwrap() {
        let mut request = c.clone();
        request.as_object_mut().unwrap().remove("id");
        let out: Value =
            serde_json::from_slice(&call_json(&serde_json::to_vec(&request).unwrap())).unwrap();
        assert!(out.get("error").is_some(), "{}: {out}", c["id"]);
    }
}
