//! Servidor de plugins: o que a IDE e o `bluescreen-plugin-server` precisam combinar.
//! Um plugin viaja como um pacote JSON: `{ id, version, manifest, sha256, size, files: [{ path, data }] }`, com
//! `data` em base64. O `sha256` cobre os arquivos (caminho e conteúdo, em ordem de caminho), então a IDE confere
//! o pacote inteiro antes de instalar, sem depender de zip.
use sha2::{Digest, Sha256};
use std::cmp::Ordering;
use std::path::Path;

/// id de plugin: letras, números, `-` e `_`, começando por letra ou número (o mesmo do plugin.json).
pub fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().next().is_some_and(|c| c.is_ascii_alphanumeric())
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}
/// versão: "1.2.3", "1.2", "2.0.0-beta.1" (vira nome de pasta no servidor)
pub fn valid_version(v: &str) -> bool {
    !v.is_empty() && v.len() <= 40 && v.chars().next().is_some_and(|c| c.is_ascii_digit())
        && v.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '+')
}

/// Compara versões: os números do começo um a um ("1.10" > "1.9"); com os números iguais, a versão sem sufixo
/// ganha da com sufixo ("1.0.0" > "1.0.0-beta"), e sufixos se comparam como texto.
pub fn version_cmp(a: &str, b: &str) -> Ordering {
    fn key(v: &str) -> (Vec<u64>, Option<&str>) {
        let v = v.trim().trim_start_matches(['v', 'V']);
        let v = v.split('+').next().unwrap_or(v);
        let (core, pre) = match v.find('-') { Some(i) => (&v[..i], Some(&v[i + 1..])), None => (v, None) };
        (core.split('.').map(|n| n.trim().parse::<u64>().unwrap_or(0)).collect(), pre)
    }
    let ((na, pa), (nb, pb)) = (key(a), key(b));
    for i in 0..na.len().max(nb.len()) {
        match na.get(i).unwrap_or(&0).cmp(nb.get(i).unwrap_or(&0)) { Ordering::Equal => {}, o => return o }
    }
    match (pa, pb) { (None, None) => Ordering::Equal, (None, Some(_)) => Ordering::Greater, (Some(_), None) => Ordering::Less, (Some(x), Some(y)) => x.cmp(y) }
}

/// Caminho relativo seguro dentro do pacote: sem `..`, sem raiz, sem unidade, separado por `/`.
pub fn safe_rel(p: &str) -> bool {
    !p.is_empty() && p.len() <= 400 && !p.starts_with('/') && !p.contains('\\') && !p.contains(':')
        && p.split('/').all(|c| !c.is_empty() && c != "." && c != ".." && !c.ends_with(['.', ' ']) && !c.chars().any(|ch| ch.is_control() || "*?\"<>|".contains(ch)))
}

/// sha256 do pacote: para cada arquivo, em ordem de caminho, o caminho, um 0, o tamanho (u64 LE) e o conteúdo.
pub fn bundle_hash(files: &[(String, Vec<u8>)]) -> String {
    let mut idx: Vec<&(String, Vec<u8>)> = files.iter().collect();
    idx.sort_by(|a, b| a.0.cmp(&b.0));
    let mut h = Sha256::new();
    for (p, data) in idx {
        h.update(p.as_bytes()); h.update([0u8]); h.update((data.len() as u64).to_le_bytes()); h.update(data);
    }
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

/// Arquivos de uma pasta de plugin, com caminho relativo (`/`). `skip(rel, is_dir)` deixa de fora pastas e arquivos.
pub fn read_files(dir: &Path, skip: &dyn Fn(&str, bool) -> bool) -> std::io::Result<Vec<(String, Vec<u8>)>> {
    fn walk(base: &Path, cur: &Path, skip: &dyn Fn(&str, bool) -> bool, out: &mut Vec<(String, Vec<u8>)>) -> std::io::Result<()> {
        for e in std::fs::read_dir(cur)? {
            let e = e?;
            let p = e.path();
            let rel = p.strip_prefix(base).unwrap_or(&p).to_string_lossy().replace('\\', "/");
            let dir = e.file_type()?.is_dir();
            if skip(&rel, dir) { continue; }
            if dir { walk(base, &p, skip, out)?; } else { out.push((rel, std::fs::read(&p)?)); }
        }
        Ok(())
    }
    let mut out = vec![];
    walk(dir, dir, skip, &mut out)?;
    out.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn versions() {
        assert_eq!(version_cmp("1.10.0", "1.9.9"), Ordering::Greater);
        assert_eq!(version_cmp("1.0", "1.0.0"), Ordering::Equal);
        assert_eq!(version_cmp("1.0.0", "1.0.0-beta"), Ordering::Greater);
        assert_eq!(version_cmp("v2.0.0-beta.2", "2.0.0-beta.10"), Ordering::Greater); // sufixo é texto
        assert_eq!(version_cmp("0.1.0", "0.2.0"), Ordering::Less);
    }
    #[test]
    fn paths() {
        assert!(safe_rel("ui.js") && safe_rel("lib/a.js"));
        assert!(!safe_rel("../x") && !safe_rel("/x") && !safe_rel("a\\b") && !safe_rel("C:/x") && !safe_rel("a//b") && !safe_rel("a/./b"));
        assert!(valid_id("sheets") && !valid_id("-x") && !valid_id("a/b"));
        assert!(valid_version("1.0.0-beta.1") && !valid_version("../1") && !valid_version("x1"));
    }
    #[test]
    fn hash_ignores_order() {
        let a = vec![("a".to_string(), b"1".to_vec()), ("b".to_string(), b"2".to_vec())];
        let b = vec![a[1].clone(), a[0].clone()];
        assert_eq!(bundle_hash(&a), bundle_hash(&b));
        assert_ne!(bundle_hash(&a), bundle_hash(&[("a".to_string(), b"12".to_vec())]));
    }
}
