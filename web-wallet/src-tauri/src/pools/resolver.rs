//! DNS-SD resolver for pool discovery.

use std::collections::BTreeMap;

/// Parsed DNS-SD TXT record: `name` (required for usable entry) + extras.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ParsedTxt {
    pub name: Option<String>,
    pub url: Option<String>,
    pub extras: BTreeMap<String, String>,
}

/// Parse a flat list of DNS-SD TXT character-strings into a `ParsedTxt`.
///
/// Strings without `=` are discarded (per RFC 6763 §6.4 we MAY accept them as
/// boolean flags; we don't use any so they're dropped). `name` and `url` are
/// promoted to dedicated fields; everything else lives in `extras`.
pub fn parse_txt(strings: &[String]) -> ParsedTxt {
    let mut out = ParsedTxt::default();
    for s in strings {
        let Some(eq) = s.find('=') else {
            continue;
        };
        let key = &s[..eq];
        let val = &s[eq + 1..];
        match key {
            "name" => out.name = Some(val.to_string()),
            "url" => out.url = Some(val.to_string()),
            _ => {
                out.extras.insert(key.to_string(), val.to_string());
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_txt_extracts_name_and_extras() {
        let strings = vec![
            "name=Nogrod Mainnet".to_string(),
            "operator=Nogrod".to_string(),
        ];
        let parsed = parse_txt(&strings);
        assert_eq!(parsed.name.as_deref(), Some("Nogrod Mainnet"));
        assert_eq!(parsed.extras.get("operator").map(String::as_str), Some("Nogrod"));
    }

    #[test]
    fn parse_txt_ignores_strings_without_equals() {
        let strings = vec!["badformat".to_string(), "name=Foo".to_string()];
        let parsed = parse_txt(&strings);
        assert_eq!(parsed.name.as_deref(), Some("Foo"));
        assert!(parsed.extras.is_empty());
    }

    #[test]
    fn parse_txt_promotes_url_field() {
        let strings = vec!["url=https://alt.example.com/api".to_string()];
        let parsed = parse_txt(&strings);
        assert_eq!(parsed.url.as_deref(), Some("https://alt.example.com/api"));
    }

    #[test]
    fn parse_txt_handles_empty_value() {
        let strings = vec!["operator=".to_string()];
        let parsed = parse_txt(&strings);
        assert_eq!(parsed.extras.get("operator").map(String::as_str), Some(""));
    }
}
