//! DPAPI binds reconstructed-package integrity receipts to this Windows user.
use super::*;
#[derive(Serialize, Deserialize)]
struct Receipt {
    channel: Channel,
    file: String,
    signed_sha256: String,
    size: u64,
    hash: String,
}
fn path(package: &Path) -> PathBuf {
    package.with_extension("mxplorer-receipt")
}
pub(super) fn save(package: &Path, asset: &VelopackAsset, channel: Channel) -> Result<()> {
    let (size, hash) = sha_file(package)?;
    let receipt = Receipt {
        channel,
        file: asset.FileName.clone(),
        signed_sha256: asset.SHA256.clone(),
        size,
        hash,
    };
    let bytes = serde_json::to_vec(&receipt).map_err(|e| e.to_string())?;
    fs::write(path(package), protect(&bytes, false)?).map_err(|e| e.to_string())
}
pub(super) fn verify(package: &Path, asset: &VelopackAsset, channel: Channel) -> Result<()> {
    let encrypted = fs::read(path(package)).map_err(|e| e.to_string())?;
    let bytes = protect(&encrypted, true)?;
    let receipt: Receipt = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    if receipt.channel != channel
        || receipt.file != asset.FileName
        || receipt.signed_sha256 != asset.SHA256
        || sha_file(package)? != (receipt.size, receipt.hash)
    {
        return Err("Cached reconstructed package has changed".into());
    }
    Ok(())
}
#[cfg(windows)]
fn protect(bytes: &[u8], decrypt: bool) -> Result<Vec<u8>> {
    use windows::{
        core::PCWSTR,
        Win32::{
            Foundation::{LocalFree, HLOCAL},
            Security::Cryptography::*,
        },
    };
    if bytes.len() > 65536 {
        return Err("Update receipt exceeds size limit".into());
    }
    let input = CRYPT_INTEGER_BLOB {
        cbData: bytes.len() as u32,
        pbData: bytes.as_ptr().cast_mut(),
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe {
        let result = if decrypt {
            CryptUnprotectData(
                &input,
                None,
                None,
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptProtectData(
                &input,
                PCWSTR::null(),
                None,
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };
        result.map_err(|_| "Windows could not authenticate update receipt")?;
        let bytes = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(output.pbData.cast())));
        Ok(bytes)
    }
}
#[cfg(not(windows))]
fn protect(_: &[u8], _: bool) -> Result<Vec<u8>> {
    Err("Update receipts require Windows DPAPI".into())
}
