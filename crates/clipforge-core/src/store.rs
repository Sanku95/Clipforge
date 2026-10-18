use crate::Result;
use serde_json::Value;
use std::fs;
use std::io::Write;
use std::path::Path;

/// Load JSON from disk. A missing file is an empty list. A corrupt file is
/// moved aside (never deleted) and treated as empty so the app still starts.
pub fn load_json(path: &Path) -> Result<Value> {
    match fs::read_to_string(path) {
        Ok(text) => match serde_json::from_str::<Value>(&text) {
            Ok(v) => Ok(v),
            Err(_) => {
                let backup = path.with_extension("corrupt.json");
                let _ = fs::rename(path, backup);
                Ok(Value::Array(vec![]))
            }
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Value::Array(vec![])),
        Err(e) => Err(e.into()),
    }
}

/// Write JSON atomically (temp file in the same folder, then rename).
pub fn save_json(path: &Path, value: &Value) -> Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("json.tmp");
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(serde_json::to_string_pretty(value).unwrap_or_else(|_| "[]".into()).as_bytes())?;
        f.sync_all()?;
    }
    fs::rename(tmp, path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn missing_file_is_empty_list() {
        let d = tempfile::tempdir().unwrap();
        assert_eq!(load_json(&d.path().join("p.json")).unwrap(), json!([]));
    }

    #[test]
    fn round_trips() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("sub").join("p.json");
        save_json(&p, &json!([{"id": "a"}])).unwrap();
        assert_eq!(load_json(&p).unwrap(), json!([{"id": "a"}]));
    }

    #[test]
    fn corrupt_file_is_kept_aside() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("p.json");
        fs::write(&p, "{ not json").unwrap();
        assert_eq!(load_json(&p).unwrap(), json!([]));
        assert!(d.path().join("p.corrupt.json").exists());
    }
}
