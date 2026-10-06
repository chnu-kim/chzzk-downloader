//! JSON Schema의 작은 부분 집합 검증기(release/latest.schema.json 전용). 모르는 키워드가 스키마에 있으면 **오류**다
//! (지원하지 않는 제약이 조용히 무시되지 않게). 지원: type(object·string·integer·boolean·array), required, properties,
//! additionalProperties(bool·스키마), propertyNames, minProperties, pattern(Rust regex, 전체 일치는 ^…$로 쓴다),
//! minLength, maxLength, const, enum. 주석 키워드($schema, $id, $comment, title, description)는 건너뛴다.

use regex::Regex;
use serde_json::Value;

const ANNOTATIONS: &[&str] = &["$schema", "$id", "$comment", "title", "description"];
const KEYWORDS: &[&str] = &[
    "type",
    "required",
    "properties",
    "additionalProperties",
    "propertyNames",
    "minProperties",
    "pattern",
    "minLength",
    "maxLength",
    "const",
    "enum",
];

/// 값이 스키마에 맞으면 빈 목록, 아니면 "경로: 이유" 목록. 스키마 자체가 잘못되면 Err.
pub fn validate(schema: &Value, v: &Value) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    walk(schema, v, "$", &mut out)?;
    Ok(out)
}

fn type_ok(t: &str, v: &Value) -> Result<bool, String> {
    Ok(match t {
        "object" => v.is_object(),
        "string" => v.is_string(),
        "integer" => v.is_i64() || v.is_u64(),
        "boolean" => v.is_boolean(),
        "array" => v.is_array(),
        other => return Err(format!("지원하지 않는 type: {other}")),
    })
}

fn walk(s: &Value, v: &Value, path: &str, out: &mut Vec<String>) -> Result<(), String> {
    let Some(s) = s.as_object() else {
        return Err(format!("{path}: 스키마가 객체가 아니다"));
    };
    for k in s.keys() {
        if !ANNOTATIONS.contains(&k.as_str()) && !KEYWORDS.contains(&k.as_str()) {
            return Err(format!("{path}: 지원하지 않는 키워드 {k}"));
        }
    }
    if let Some(t) = s.get("type") {
        let t = t.as_str().ok_or(format!("{path}: type은 문자열 하나만"))?;
        if !type_ok(t, v)? {
            out.push(format!("{path}: {t}가 아니다"));
            return Ok(());
        }
    }
    if let Some(c) = s.get("const")
        && c != v
    {
        out.push(format!("{path}: {c}와 다르다"));
    }
    if let Some(e) = s.get("enum") {
        let e = e.as_array().ok_or(format!("{path}: enum은 배열"))?;
        if !e.contains(v) {
            out.push(format!("{path}: 허용 값이 아니다"));
        }
    }
    if let Some(str_v) = v.as_str() {
        let len = str_v.chars().count() as u64;
        if let Some(n) = s.get("minLength").and_then(Value::as_u64)
            && len < n
        {
            out.push(format!("{path}: 길이 {len} < {n}"));
        }
        if let Some(n) = s.get("maxLength").and_then(Value::as_u64)
            && len > n
        {
            out.push(format!("{path}: 길이 {len} > {n}"));
        }
        if let Some(p) = s.get("pattern") {
            let p = p.as_str().ok_or(format!("{path}: pattern은 문자열"))?;
            let re = Regex::new(p).map_err(|e| format!("{path}: pattern 오류 {e}"))?;
            if !re.is_match(str_v) {
                out.push(format!("{path}: 형식이 맞지 않는다({p})"));
            }
        }
    }
    if let Some(obj) = v.as_object() {
        if let Some(n) = s.get("minProperties").and_then(Value::as_u64)
            && (obj.len() as u64) < n
        {
            out.push(format!("{path}: 속성 {}개 < {n}", obj.len()));
        }
        if let Some(req) = s.get("required") {
            for r in req.as_array().ok_or(format!("{path}: required는 배열"))? {
                let r = r
                    .as_str()
                    .ok_or(format!("{path}: required 항목은 문자열"))?;
                if !obj.contains_key(r) {
                    out.push(format!("{path}: {r}가 없다"));
                }
            }
        }
        let props = s.get("properties").and_then(Value::as_object);
        for (k, val) in obj {
            let sub = format!("{path}.{k}");
            if let Some(names) = s.get("propertyNames") {
                walk(
                    names,
                    &Value::String(k.clone()),
                    &format!("{path}[키 {k}]"),
                    out,
                )?;
            }
            match props.and_then(|p| p.get(k)) {
                Some(ps) => walk(ps, val, &sub, out)?,
                None => match s.get("additionalProperties") {
                    Some(Value::Bool(false)) => out.push(format!("{path}: 허용하지 않는 속성 {k}")),
                    Some(Value::Bool(true)) | None => {}
                    Some(ap) => walk(ap, val, &sub, out)?,
                },
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn basic_rules() {
        let s = json!({
            "type": "object",
            "required": ["a"],
            "additionalProperties": false,
            "properties": { "a": { "type": "string", "pattern": "^x+$", "minLength": 2 }, "b": { "const": 1 } }
        });
        assert!(validate(&s, &json!({"a": "xx"})).unwrap().is_empty());
        assert!(!validate(&s, &json!({"a": "x"})).unwrap().is_empty());
        assert!(!validate(&s, &json!({"a": "xy"})).unwrap().is_empty());
        assert!(!validate(&s, &json!({})).unwrap().is_empty());
        assert!(
            !validate(&s, &json!({"a": "xx", "c": 1}))
                .unwrap()
                .is_empty()
        );
        assert!(
            !validate(&s, &json!({"a": "xx", "b": 2}))
                .unwrap()
                .is_empty()
        );
        assert!(!validate(&s, &json!([])).unwrap().is_empty());
    }

    #[test]
    fn unknown_keyword_is_schema_error() {
        assert!(validate(&json!({"format": "uri"}), &json!("x")).is_err());
        assert!(validate(&json!({"type": ["string"]}), &json!("x")).is_err());
    }

    #[test]
    fn additional_properties_schema_and_property_names() {
        let s = json!({"type": "object", "propertyNames": {"pattern": "^[a-z]+$"}, "additionalProperties": {"type": "integer"}});
        assert!(validate(&s, &json!({"ab": 1})).unwrap().is_empty());
        assert!(!validate(&s, &json!({"Ab": 1})).unwrap().is_empty());
        assert!(!validate(&s, &json!({"ab": "1"})).unwrap().is_empty());
    }
}
