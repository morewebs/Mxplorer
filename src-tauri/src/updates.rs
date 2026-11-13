use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signature, VerifyingKey};
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc::Sender,
        Arc, Mutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{Manager, Webview};
use velopack::{
    sources::UpdateSource, UpdateInfo, UpdateManager, UpdateOptions, VelopackAsset,
    VelopackAssetFeed,
};
type Result<T> = std::result::Result<T, String>;
const MAX_FEED: u64 = 1024 * 1024;
const MAX_PACKAGE: u64 = 1024 * 1024 * 1024;
const RELEASE_PREFIX: &str = "https://github.com/morewebs/Mxplorer/releases/download/";
const FEED_PREFIX: &str = "https://morewebs.github.io/Mxplorer/";
mod receipt;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Channel {
    Stable,
    Nightly,
}
impl Channel {
    fn as_str(self) -> &'static str {
        match self {
            Self::Stable => "stable",
            Self::Nightly => "nightly",
        }
    }
    fn build_default() -> Self {
        if option_env!("MXPLORER_CHANNEL") == Some("nightly") {
            Self::Nightly
        } else {
            Self::Stable
        }
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Envelope {
    payload: String,
    signature: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Payload {
    schema: u32,
    channel: Channel,
    published_at: String,
    assets: Vec<SignedAsset>,
}
#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct SignedAsset {
    asset: VelopackAsset,
    url: String,
}
fn valid_name(name: &str) -> bool {
    if name.len() > 200
        || !name.ends_with(".nupkg")
        || !name
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c))
        || name.contains("..")
    {
        return false;
    }
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    !matches!(
        stem.as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    )
}
fn valid_asset_url(raw: &str, name: &str) -> bool {
    let Ok(url) = url::Url::parse(raw) else {
        return false;
    };
    let Some(tail) = raw.strip_prefix(RELEASE_PREFIX) else {
        return false;
    };
    let parts = tail.split('/').collect::<Vec<_>>();
    url.scheme() == "https"
        && url.host_str() == Some("github.com")
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
        && url.query().is_none()
        && url.fragment().is_none()
        && parts.len() == 2
        && !parts[0].is_empty()
        && parts[0] != "."
        && parts[0] != ".."
        && parts[1] == name
}
fn verify_feed(bytes: &[u8], key: &[u8; 32], channel: Channel) -> Result<Vec<SignedAsset>> {
    if bytes.len() as u64 > MAX_FEED {
        return Err("Update feed exceeds its size limit".into());
    }
    let envelope: Envelope =
        serde_json::from_slice(bytes).map_err(|e| format!("Invalid update envelope: {e}"))?;
    let payload = STANDARD
        .decode(envelope.payload)
        .map_err(|_| "Invalid feed encoding")?;
    let signature = STANDARD
        .decode(envelope.signature)
        .map_err(|_| "Invalid signature encoding")?;
    let signature = Signature::from_slice(&signature).map_err(|_| "Invalid feed signature")?;
    VerifyingKey::from_bytes(key)
        .map_err(|_| "Invalid update public key")?
        .verify_strict(&payload, &signature)
        .map_err(|_| "Update feed authentication failed")?;
    let feed: Payload = serde_json::from_slice(&payload)
        .map_err(|e| format!("Invalid signed update payload: {e}"))?;
    if feed.schema != 1
        || feed.channel != channel
        || feed.assets.len() > 64
        || !valid_timestamp(&feed.published_at)
    {
        return Err("Invalid update schema, channel or timestamp".into());
    }
    let mut names = HashSet::new();
    let mut versions = HashSet::new();
    for entry in &feed.assets {
        let a = &entry.asset;
        let ver = Version::parse(&a.Version).map_err(|_| "Invalid package version")?;
        let pre = ver.pre.as_str().split('.').collect::<Vec<_>>();
        let nightly = matches!(pre.as_slice(),["nightly",run,attempt] if !run.is_empty() && !attempt.is_empty() && run.bytes().all(|b|b.is_ascii_digit()) && attempt.bytes().all(|b|b.is_ascii_digit()));
        let tag = if channel == Channel::Stable {
            format!("v{}", a.Version)
        } else {
            format!("nightly-{}", a.Version)
        };
        if a.PackageId != "Mxplorer"
            || !matches!(a.Type.as_str(), "Full" | "Delta")
            || !valid_name(&a.FileName)
            || !a.FileName.starts_with("Mxplorer-")
            || !valid_asset_url(&entry.url, &a.FileName)
            || entry.url != format!("{RELEASE_PREFIX}{tag}/{}", a.FileName)
            || a.Size == 0
            || a.Size > MAX_PACKAGE
            || a.SHA256.len() != 64
            || !a.SHA256.bytes().all(|b| b.is_ascii_hexdigit())
            || a.SHA1.len() != 40
            || !a.SHA1.bytes().all(|b| b.is_ascii_hexdigit())
            || !names.insert(a.FileName.to_ascii_lowercase())
            || !versions.insert((a.Version.clone(), a.Type.clone()))
            || (channel == Channel::Stable && !ver.pre.is_empty())
            || (channel == Channel::Nightly && !nightly)
            || !ver.build.is_empty()
        {
            return Err("Invalid or conflicting signed package metadata".into());
        }
    }
    Ok(feed.assets)
}
fn valid_timestamp(value: &str) -> bool {
    chrono::DateTime::parse_from_rfc3339(value).is_ok()
}
fn version_allowed(current: &str, target: &str, switch: bool) -> bool {
    match (Version::parse(current), Version::parse(target)) {
        (Ok(a), Ok(b)) => switch || b > a,
        _ => false,
    }
}
fn sha_file(path: &Path) -> Result<(u64, String)> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut size = 0;
    let mut buf = [0u8; 65536];
    loop {
        let n = file.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        size += n as u64;
        if size > MAX_PACKAGE {
            return Err("Package exceeds size limit".into());
        }
        hasher.update(&buf[..n]);
    }
    Ok((size, format!("{:x}", hasher.finalize())))
}
fn verify_file(path: &Path, asset: &VelopackAsset) -> Result<()> {
    let (size, hash) = sha_file(path)?;
    if size != asset.Size || !hash.eq_ignore_ascii_case(&asset.SHA256) {
        return Err("Update package integrity check failed".into());
    }
    Ok(())
}
fn response(raw: &str, timeout: Duration, feed: bool) -> Result<ureq::Response> {
    let agent = ureq::AgentBuilder::new()
        .redirects(0)
        .timeout(timeout)
        .timeout_connect(Duration::from_secs(15))
        .build();
    let mut current = raw.to_string();
    for _ in 0..5 {
        let url = url::Url::parse(&current).map_err(|_| "Invalid update URL")?;
        if url.scheme() != "https"
            || !(matches!(
                url.host_str(),
                Some(
                    "github.com"
                        | "release-assets.githubusercontent.com"
                        | "objects.githubusercontent.com"
                )
            ) || (feed && url.host_str() == Some("morewebs.github.io")))
            || !url.username().is_empty()
            || url.password().is_some()
            || url.port().is_some()
        {
            return Err("Unsafe update redirect".into());
        }
        let res = match agent
            .get(&current)
            .set("User-Agent", "Mxplorer-Updater")
            .call()
        {
            Ok(r) => r,
            Err(ureq::Error::Status(_, r)) => r,
            Err(e) => return Err(format!("Update request failed: {e}")),
        };
        if (300..400).contains(&res.status()) {
            current = url
                .join(res.header("Location").ok_or("Missing update redirect")?)
                .map_err(|_| "Invalid update redirect")?
                .to_string();
        } else {
            return Ok(res);
        }
    }
    Err("Too many update redirects".into())
}
#[derive(Clone)]
struct SignedSource {
    channel: Channel,
    entries: Arc<Vec<SignedAsset>>,
    bytes: Arc<AtomicU64>,
    full_downloaded: Arc<AtomicBool>,
}
impl SignedSource {
    fn fetch(channel: Channel) -> Result<Self> {
        let res = response(
            &format!("{FEED_PREFIX}{}.json", channel.as_str()),
            Duration::from_secs(45),
            true,
        )?;
        let entries = if res.status() == 404 {
            Vec::new()
        } else {
            if res.status() != 200 {
                return Err(format!("Update feed HTTP {}", res.status()));
            }
            let mut bytes = Vec::new();
            res.into_reader()
                .take(MAX_FEED + 1)
                .read_to_end(&mut bytes)
                .map_err(|e| e.to_string())?;
            let key: [u8; 32] = STANDARD
                .decode(include_str!("../update-public-key.txt").trim())
                .map_err(|_| "Invalid update key encoding")?
                .try_into()
                .map_err(|_| "Invalid update key length")?;
            verify_feed(&bytes, &key, channel)?
        };
        Ok(Self {
            channel,
            entries: Arc::new(entries),
            bytes: Arc::new(AtomicU64::new(0)),
            full_downloaded: Arc::new(AtomicBool::new(false)),
        })
    }
    fn download(
        &self,
        asset: &VelopackAsset,
        path: &Path,
        progress: Option<Sender<i16>>,
    ) -> Result<()> {
        let entry = self
            .entries
            .iter()
            .find(|entry| {
                entry.asset.FileName == asset.FileName
                    && entry.asset.SHA256 == asset.SHA256
                    && entry.asset.Size == asset.Size
                    && entry.asset.Version == asset.Version
                    && entry.asset.Type == asset.Type
            })
            .ok_or("Package is absent from authenticated feed")?;
        if asset.Type == "Full" {
            self.full_downloaded.store(true, Ordering::Relaxed)
        }
        let mut last = String::new();
        for _ in 0..2 {
            let result = (|| {
                let res = response(&entry.url, Duration::from_secs(600), false)?;
                if res.status() != 200 {
                    return Err(format!("Package HTTP {}", res.status()));
                }
                if let Some(n) = res
                    .header("Content-Length")
                    .and_then(|s| s.parse::<u64>().ok())
                {
                    if n != asset.Size {
                        return Err("Package size does not match signed feed".into());
                    }
                }
                let mut reader = res.into_reader();
                let mut file = fs::File::create(path).map_err(|e| e.to_string())?;
                let mut size = 0;
                let mut buf = [0u8; 65536];
                let mut hash = Sha256::new();
                loop {
                    let n = reader.read(&mut buf).map_err(|e| e.to_string())?;
                    if n == 0 {
                        break;
                    }
                    size += n as u64;
                    self.bytes.fetch_add(n as u64, Ordering::Relaxed);
                    if size > asset.Size {
                        return Err("Package exceeds signed size".into());
                    }
                    file.write_all(&buf[..n]).map_err(|e| e.to_string())?;
                    hash.update(&buf[..n]);
                    if let Some(sender) = &progress {
                        let _ = sender.send(((size as f64 / asset.Size as f64) * 100.0) as i16);
                    }
                }
                if size != asset.Size
                    || !format!("{:x}", hash.finalize()).eq_ignore_ascii_case(&asset.SHA256)
                {
                    return Err("Package authentication failed".into());
                }
                file.sync_all().map_err(|e| e.to_string())?;
                Ok(())
            })();
            match result {
                Ok(()) => return Ok(()),
                Err(e) => {
                    last = e;
                    let _ = fs::remove_file(path);
                }
            }
        }
        Err(last)
    }
}
impl UpdateSource for SignedSource {
    fn get_release_feed(
        &self,
        channel: &str,
        _: &velopack::bundle::Manifest,
        _: &str,
    ) -> std::result::Result<VelopackAssetFeed, velopack::Error> {
        if channel != self.channel.as_str() {
            return Err(velopack::Error::Other("Update channel mismatch".into()));
        }
        Ok(VelopackAssetFeed {
            Assets: self.entries.iter().map(|e| e.asset.clone()).collect(),
        })
    }
    fn download_release_entry(
        &self,
        asset: &VelopackAsset,
        path: &Path,
        progress: Option<Sender<i16>>,
    ) -> std::result::Result<(), velopack::Error> {
        self.download(asset, path, progress)
            .map_err(velopack::Error::Other)
    }
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    current_version: String,
    channel: Channel,
    installed: bool,
    phase: String,
    progress: Option<f64>,
    available_version: Option<String>,
    release_notes: Option<String>,
    download_bytes: Option<u64>,
    full_bytes: Option<u64>,
    delta: bool,
    error: Option<String>,
    last_checked_at: Option<u64>,
    channel_switch: bool,
}
impl UpdateStatus {
    fn new(installed: bool, channel: Channel) -> Self {
        Self {
            current_version: env!("CARGO_PKG_VERSION").into(),
            channel,
            installed,
            phase: "idle".into(),
            progress: None,
            available_version: None,
            release_notes: None,
            download_bytes: None,
            full_bytes: None,
            delta: false,
            error: None,
            last_checked_at: None,
            channel_switch: false,
        }
    }
    fn select_channel(&mut self, channel: Channel) {
        let installed = self.installed;
        let current = self.current_version.clone();
        *self = Self::new(installed, channel);
        self.current_version = current;
        self.channel_switch = channel != Channel::build_default();
    }
}
struct Checked {
    manager: UpdateManager,
    source: SignedSource,
    info: UpdateInfo,
    packages: PathBuf,
    channel: Channel,
}
fn delta_chain_allowed(
    base: &str,
    target: &VelopackAsset,
    assets: &[VelopackAsset],
    deltas: &[VelopackAsset],
) -> bool {
    let (Ok(base), Ok(target_version)) = (Version::parse(base), Version::parse(&target.Version))
    else {
        return false;
    };
    if deltas.is_empty()
        || deltas.len() > 10
        || deltas.iter().map(|a| a.Size).sum::<u64>() >= target.Size
    {
        return false;
    }
    let mut versions = assets
        .iter()
        .filter(|a| a.Type == "Full")
        .filter_map(|a| Version::parse(&a.Version).ok())
        .filter(|v| v > &base && v <= &target_version)
        .collect::<Vec<_>>();
    versions.sort();
    versions.len() == deltas.len()
        && versions
            .iter()
            .zip(deltas)
            .all(|(v, d)| Version::parse(&d.Version).ok().as_ref() == Some(v))
}
struct Pending {
    path: PathBuf,
    size: u64,
    hash: String,
    channel: Channel,
}
impl Pending {
    fn verify(&self, channel: Channel) -> Result<()> {
        if self.channel != channel || sha_file(&self.path)? != (self.size, self.hash.clone()) {
            return Err("Staged update verification failed; download it again".into());
        }
        Ok(())
    }
}
struct Inner {
    status: UpdateStatus,
    checked: Option<Checked>,
    pending: Option<Pending>,
}
pub struct UpdateState {
    operation: Mutex<()>,
    inner: Mutex<Inner>,
    preferences: PathBuf,
}
impl UpdateState {
    fn new(installed: bool, channel: Channel, preferences: PathBuf) -> Self {
        Self {
            operation: Mutex::new(()),
            inner: Mutex::new(Inner {
                status: UpdateStatus::new(installed, channel),
                checked: None,
                pending: None,
            }),
            preferences,
        }
    }
    fn begin(&self) -> Result<std::sync::MutexGuard<'_, ()>> {
        self.operation
            .try_lock()
            .map_err(|_| "An update operation is already running".into())
    }
    fn snapshot(&self) -> Result<UpdateStatus> {
        Ok(self
            .inner
            .lock()
            .map_err(|_| "Update state unavailable")?
            .status
            .clone())
    }
    fn change(
        &self,
        app: &tauri::AppHandle,
        change: impl FnOnce(&mut Inner),
    ) -> Result<UpdateStatus> {
        let mut inner = self.inner.lock().map_err(|_| "Update state unavailable")?;
        change(&mut inner);
        let status = inner.status.clone();
        super::emit(app, "update-status", status.clone());
        Ok(status)
    }
}
pub fn initialize(app: &tauri::AppHandle) -> Result<()> {
    let folder = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let preferences = folder.join("update-channel.json");
    let channel = fs::read(&preferences)
        .ok()
        .and_then(|b| serde_json::from_slice::<Channel>(&b).ok())
        .unwrap_or_else(Channel::build_default);
    let installed = managed_locator().is_ok();
    let state = UpdateState::new(installed, channel, preferences);
    state
        .inner
        .lock()
        .map_err(|_| "Update state unavailable")?
        .status
        .channel_switch = channel != Channel::build_default();
    app.manage(state);
    Ok(())
}
fn managed_locator() -> Result<velopack::locator::VelopackLocator> {
    let locator = velopack::locator::auto_locate_app_manifest(
        velopack::locator::LocationContext::FromCurrentExe,
    )
    .map_err(|e| e.to_string())?;
    if locator.get_manifest_id() != "Mxplorer"
        || locator.get_manifest_version_full_string() != env!("CARGO_PKG_VERSION")
    {
        return Err("Running build is not a matching managed installation".into());
    }
    Ok(locator)
}
fn prepare_base(
    packages: &Path,
    base: &VelopackAsset,
    assets: &[VelopackAsset],
    channel: Channel,
) -> Option<VelopackAsset> {
    if base.PackageId != "Mxplorer" || base.Type != "Full" || !valid_name(&base.FileName) {
        return None;
    }
    let asset = assets.iter().find(|a| {
        a.PackageId == "Mxplorer"
            && a.Type == "Full"
            && a.Version == base.Version
            && valid_name(&a.FileName)
    })?;
    let candidate = packages.join(&base.FileName);
    if verify_file(&candidate, asset).is_err()
        && receipt::verify(&candidate, asset, channel).is_err()
    {
        return None;
    }
    let canonical = packages.join(&asset.FileName);
    // Setup and Update.exe use ID-version-full.nupkg, omitting the channel.
    // Normalize only authenticated bytes so Velopack's patcher gets the exact
    // canonical BaseRelease path represented by the signed feed.
    if candidate != canonical {
        fs::copy(&candidate, &canonical).ok()?;
        if verify_file(&canonical, asset).is_err()
            && receipt::verify(&canonical, asset, channel).is_err()
        {
            return None;
        }
    }
    Some(asset.clone())
}
fn checked(channel: Channel, switch: bool) -> Result<Option<Checked>> {
    let locator = managed_locator()?;
    let source = SignedSource::fetch(channel)?;
    let manager = UpdateManager::new(
        source.clone(),
        Some(UpdateOptions {
            ExplicitChannel: Some(channel.as_str().into()),
            AllowVersionDowngrade: switch,
            MaximumDeltasBeforeFallback: 10,
        }),
        None,
    )
    .map_err(|e| e.to_string())?;
    let velopack::UpdateCheck::UpdateAvailable(info) =
        manager.check_for_updates().map_err(|e| e.to_string())?
    else {
        return Ok(None);
    };
    let mut info = *info;
    if !version_allowed(
        env!("CARGO_PKG_VERSION"),
        &info.TargetFullRelease.Version,
        switch,
    ) {
        return Ok(None);
    }
    let packages = locator.get_packages_dir();
    let assets = source
        .entries
        .iter()
        .map(|e| e.asset.clone())
        .collect::<Vec<_>>();
    let trusted_base = if switch {
        None
    } else {
        info.BaseRelease
            .as_ref()
            .and_then(|base| prepare_base(&packages, base, &assets, channel))
    };
    if switch
        || trusted_base.is_none()
        || !delta_chain_allowed(
            &trusted_base
                .as_ref()
                .map(|a| a.Version.clone())
                .unwrap_or_default(),
            &info.TargetFullRelease,
            &assets,
            &info.DeltasToTarget,
        )
    {
        info.BaseRelease = None;
        info.DeltasToTarget.clear()
    } else {
        info.BaseRelease = trusted_base;
    }
    Ok(Some(Checked {
        manager,
        source,
        info,
        packages,
        channel,
    }))
}
fn fail(state: &UpdateState, app: &tauri::AppHandle, error: String) -> Result<UpdateStatus> {
    state.change(app, |inner| {
        inner.status.phase = "error".into();
        inner.status.error = Some(error);
        inner.status.progress = None;
        inner.pending = None;
    })
}
#[tauri::command]
pub fn get_update_status(caller: Webview, app: tauri::AppHandle) -> Result<UpdateStatus> {
    super::trusted(&caller)?;
    app.try_state::<UpdateState>()
        .ok_or("Update state is still initializing")?
        .snapshot()
}
#[tauri::command]
pub async fn set_update_channel(
    caller: Webview,
    app: tauri::AppHandle,
    channel: Channel,
) -> Result<UpdateStatus> {
    super::trusted(&caller)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app
            .try_state::<UpdateState>()
            .ok_or("Update state is still initializing")?;
        let _guard = state.begin()?;
        if state.snapshot()?.channel == channel {
            return state.snapshot();
        }
        fs::write(
            &state.preferences,
            serde_json::to_vec(&channel).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        state.change(&app, |inner| {
            inner.status.select_channel(channel);
            inner.checked = None;
            inner.pending = None;
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn check_for_updates(caller: Webview, app: tauri::AppHandle) -> Result<UpdateStatus> {
    super::trusted(&caller)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app
            .try_state::<UpdateState>()
            .ok_or("Update state is still initializing")?;
        let _guard = state.begin()?;
        let status = state.snapshot()?;
        if !status.installed || status.phase == "ready" {
            return Ok(status);
        }
        state.change(&app, |inner| {
            inner.status.phase = "checking".into();
            inner.status.error = None;
            inner.checked = None;
            inner.pending = None;
        })?;
        let result = checked(status.channel, status.channel_switch);
        state.change(&app, |inner| {
            inner.status.last_checked_at = Some(
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs(),
            )
        })?;
        match result {
            Err(error) => fail(&state, &app, error),
            Ok(update) => state.change(&app, |inner| {
                inner.status.phase = if update.is_some() {
                    "available"
                } else {
                    "idle"
                }
                .into();
                inner.status.available_version = update
                    .as_ref()
                    .map(|c| c.info.TargetFullRelease.Version.clone());
                inner.status.release_notes = update
                    .as_ref()
                    .map(|c| c.info.TargetFullRelease.NotesMarkdown.clone());
                inner.status.full_bytes = update.as_ref().map(|c| c.info.TargetFullRelease.Size);
                inner.status.delta = update
                    .as_ref()
                    .is_some_and(|c| !c.info.DeltasToTarget.is_empty());
                inner.status.download_bytes = update.as_ref().map(|c| {
                    if c.info.DeltasToTarget.is_empty() {
                        c.info.TargetFullRelease.Size
                    } else {
                        c.info.DeltasToTarget.iter().map(|a| a.Size).sum()
                    }
                });
                inner.checked = update;
            }),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn download_update(caller: Webview, app: tauri::AppHandle) -> Result<UpdateStatus> {
    super::trusted(&caller)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app
            .try_state::<UpdateState>()
            .ok_or("Update state is still initializing")?;
        let _guard = state.begin()?;
        let selection = state
            .inner
            .lock()
            .map_err(|_| "Update state unavailable")?
            .checked
            .take();
        let Some(selection) = selection else {
            return Err("Check for an update before downloading".into());
        };
        if selection.channel != state.snapshot()?.channel {
            return Err("Update selection has changed".into());
        }
        state.change(&app, |inner| {
            inner.status.phase = "downloading".into();
            inner.status.progress = Some(0.0);
            inner.status.error = None;
            inner.pending = None;
        })?;
        let result = stage(&state, &app, &selection);
        match result {
            Ok(pending) => state.change(&app, |inner| {
                inner.status.phase = "ready".into();
                inner.status.progress = Some(100.0);
                inner.status.delta = !selection.source.full_downloaded.load(Ordering::Relaxed);
                inner.status.download_bytes = Some(selection.source.bytes.load(Ordering::Relaxed));
                inner.pending = Some(pending);
                inner.checked = Some(selection);
            }),
            Err(error) => {
                state.change(&app, |inner| {
                    inner.status.download_bytes =
                        Some(selection.source.bytes.load(Ordering::Relaxed));
                    inner.status.delta = false;
                    inner.checked = Some(selection);
                })?;
                fail(&state, &app, error)
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
fn stage(state: &UpdateState, app: &tauri::AppHandle, selection: &Checked) -> Result<Pending> {
    let path = selection
        .packages
        .join(&selection.info.TargetFullRelease.FileName);
    // 1.2.161 skips verification on a cache hit. Never enter that branch.
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    selection.source.bytes.store(0, Ordering::Relaxed);
    selection
        .source
        .full_downloaded
        .store(false, Ordering::Relaxed);
    let mut strategy = selection.info.clone();
    if let Some(base) = &strategy.BaseRelease {
        let assets = selection
            .source
            .entries
            .iter()
            .map(|e| e.asset.clone())
            .collect::<Vec<_>>();
        strategy.BaseRelease = prepare_base(&selection.packages, base, &assets, selection.channel);
        if strategy.BaseRelease.is_none() {
            strategy.DeltasToTarget.clear();
        }
    }
    let (sender, receiver) = std::sync::mpsc::channel();
    let progress_app = app.clone();
    let progress_source = selection.source.clone();
    let progress = std::thread::spawn(move || {
        while let Ok(value) = receiver.recv() {
            let state = progress_app.state::<UpdateState>();
            let _ = state.change(&progress_app, |inner| {
                inner.status.progress = Some(f64::from(value).clamp(0.0, 100.0));
                inner.status.delta = !progress_source.full_downloaded.load(Ordering::Relaxed);
                inner.status.download_bytes = Some(progress_source.bytes.load(Ordering::Relaxed));
            });
        }
    });
    let result = selection
        .manager
        .download_updates(&strategy, Some(sender))
        .map_err(|e| e.to_string());
    let _ = progress.join();
    result?;
    if selection.source.full_downloaded.load(Ordering::Relaxed) {
        verify_file(&path, &selection.info.TargetFullRelease)?;
    }
    receipt::save(&path, &selection.info.TargetFullRelease, selection.channel)?;
    let (size, hash) = sha_file(&path)?;
    if state.snapshot()?.channel != selection.channel {
        return Err("Update channel changed".into());
    }
    Ok(Pending {
        path,
        size,
        hash,
        channel: selection.channel,
    })
}
#[tauri::command]
pub async fn install_update(caller: Webview, app: tauri::AppHandle) -> Result<UpdateStatus> {
    super::trusted(&caller)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app
            .try_state::<UpdateState>()
            .ok_or("Update state is still initializing")?;
        let _guard = state.begin()?;
        let result = (|| {
            let inner = state.inner.lock().map_err(|_| "Update state unavailable")?;
            let pending = inner
                .pending
                .as_ref()
                .ok_or("Download and verify an update before restarting")?;
            let selection = inner
                .checked
                .as_ref()
                .ok_or("Update selection unavailable")?;
            if inner.status.phase != "ready" || selection.channel != pending.channel {
                return Err("Staged update selection has changed".into());
            }
            pending.verify(inner.status.channel)?;
            selection
                .manager
                .wait_exit_then_apply_updates(&selection.info, false, true, Vec::<String>::new())
                .map_err(|e| e.to_string())?;
            Ok(())
        })();
        if let Err(error) = result {
            return fail(&state, &app, error);
        }
        let status = state.change(&app, |inner| inner.status.phase = "installing".into())?;
        app.exit(0);
        Ok(status)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::STANDARD, Engine};
    use ed25519_dalek::{Signer, SigningKey};
    use serde_json::{json, Value};

    fn payload() -> Value {
        json!({"schema":1,"channel":"stable","publishedAt":"2026-11-13T12:00:00Z","assets":[{
            "asset":{"PackageId":"Mxplorer","Version":"0.3.0","Type":"Full","FileName":"Mxplorer-0.3.0-full.nupkg","SHA1":"a".repeat(40),"SHA256":"b".repeat(64),"Size":123,"NotesMarkdown":"Release","NotesHtml":""},
            "url":"https://github.com/morewebs/Mxplorer/releases/download/v0.3.0/Mxplorer-0.3.0-full.nupkg"
        }]})
    }
    fn signed(payload: &Value) -> (Vec<u8>, [u8; 32]) {
        let key = SigningKey::from_bytes(&[42; 32]);
        let bytes = serde_json::to_vec(payload).unwrap();
        let signature = key.sign(&bytes);
        (serde_json::to_vec(&json!({"payload":STANDARD.encode(&bytes),"signature":STANDARD.encode(signature.to_bytes())})).unwrap(), key.verifying_key().to_bytes())
    }
    #[test]
    fn accepts_authenticated_feed_and_rejects_tampering() {
        let (bytes, key) = signed(&payload());
        assert_eq!(verify_feed(&bytes, &key, Channel::Stable).unwrap().len(), 1);
        let mut envelope: Value = serde_json::from_slice(&bytes).unwrap();
        envelope["payload"] = json!(STANDARD.encode(b"{}"));
        assert!(verify_feed(
            &serde_json::to_vec(&envelope).unwrap(),
            &key,
            Channel::Stable
        )
        .is_err());
    }
    #[test]
    fn rejects_cross_channel_paths_digests_and_untrusted_urls() {
        for (field, bad) in [
            ("FileName", "../evil.nupkg"),
            ("FileName", "CON.nupkg"),
            ("SHA256", "abcd"),
            ("PackageId", "Other"),
            ("Version", "nonsense"),
        ] {
            let mut p = payload();
            p["assets"][0]["asset"][field] = json!(bad);
            let (bytes, key) = signed(&p);
            assert!(
                verify_feed(&bytes, &key, Channel::Stable).is_err(),
                "accepted {field}={bad}"
            );
        }
        for url in ["http://github.com/morewebs/Mxplorer/releases/download/v0.3.0/Mxplorer-0.3.0-full.nupkg","https://evil.test/Mxplorer-0.3.0-full.nupkg","https://github.com/morewebs/Mxplorer/releases/download/v0.3.0/other.nupkg"] {
            let mut p=payload(); p["assets"][0]["url"]=json!(url);
            let (bytes,key)=signed(&p); assert!(verify_feed(&bytes,&key,Channel::Stable).is_err());
        }
        let (bytes, key) = signed(&payload());
        assert!(verify_feed(&bytes, &key, Channel::Nightly).is_err());
        let mut p = payload();
        let duplicate = p["assets"][0].clone();
        p["assets"].as_array_mut().unwrap().push(duplicate);
        let (bytes, key) = signed(&p);
        assert!(verify_feed(&bytes, &key, Channel::Stable).is_err());
    }
    #[test]
    fn signed_assets_must_match_channel_versions_and_immutable_tags() {
        let mut nightly = payload();
        nightly["channel"] = json!("nightly");
        let (bytes, key) = signed(&nightly);
        assert!(verify_feed(&bytes, &key, Channel::Nightly).is_err());
        let mut mutable = payload();
        mutable["assets"][0]["url"]=json!("https://github.com/morewebs/Mxplorer/releases/download/update-feed/Mxplorer-0.3.0-full.nupkg");
        let (bytes, key) = signed(&mutable);
        assert!(verify_feed(&bytes, &key, Channel::Stable).is_err());
        let mut bad_digest = payload();
        bad_digest["assets"][0]["asset"]["SHA1"] = json!("short");
        let (bytes, key) = signed(&bad_digest);
        assert!(verify_feed(&bytes, &key, Channel::Stable).is_err());
    }
    #[test]
    fn same_channel_refuses_rollback_but_explicit_switch_accepts_it() {
        assert!(!version_allowed("0.4.0", "0.3.0", false));
        assert!(version_allowed("0.4.0", "0.3.0", true));
        assert!(!version_allowed("0.3.0", "0.3.0", false));
        assert!(version_allowed("0.3.0", "0.3.1-nightly.1.1", false));
    }
    #[test]
    fn channel_change_invalidates_available_and_staged_selection() {
        let default = Channel::build_default();
        let alternate = if default == Channel::Stable {
            Channel::Nightly
        } else {
            Channel::Stable
        };
        let mut status = UpdateStatus::new(false, default);
        status.phase = "ready".into();
        status.available_version = Some("0.4.0".into());
        status.select_channel(alternate);
        assert_eq!(status.phase, "idle");
        assert_eq!(status.channel, alternate);
        assert!(status.available_version.is_none());
        assert!(status.channel_switch);
        status.select_channel(default);
        assert!(!status.channel_switch);
    }
    #[test]
    fn busy_mutation_is_rejected_instead_of_queued() {
        let state = UpdateState::new(false, Channel::Stable, PathBuf::new());
        let _guard = state.operation.try_lock().unwrap();
        assert!(state.begin().is_err());
    }
    #[test]
    fn deltas_require_every_intermediate_version_and_real_savings() {
        let full = |v: &str, size| VelopackAsset {
            Version: v.into(),
            Type: "Full".into(),
            Size: size,
            ..Default::default()
        };
        let delta = |v: &str, size| VelopackAsset {
            Version: v.into(),
            Type: "Delta".into(),
            Size: size,
            ..Default::default()
        };
        let target = full("0.5.0", 100);
        let entries = vec![
            full("0.3.0", 100),
            full("0.4.0", 100),
            target.clone(),
            delta("0.4.0", 20),
            delta("0.5.0", 20),
        ];
        assert!(delta_chain_allowed(
            "0.3.0",
            &target,
            &entries,
            &[delta("0.4.0", 20), delta("0.5.0", 20)]
        ));
        assert!(!delta_chain_allowed(
            "0.3.0",
            &target,
            &entries,
            &[delta("0.5.0", 20)]
        ));
        assert!(!delta_chain_allowed(
            "0.3.0",
            &target,
            &entries,
            &[delta("0.4.0", 60), delta("0.5.0", 60)]
        ));
    }
    #[test]
    fn staged_package_must_still_match_selected_channel_and_verified_bytes() {
        let folder = std::env::temp_dir().join(format!("mxplorer-update-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&folder).unwrap();
        let path = folder.join("package.nupkg");
        fs::write(&path, b"authenticated package").unwrap();
        let (size, hash) = sha_file(&path).unwrap();
        let pending = Pending {
            path: path.clone(),
            size,
            hash,
            channel: Channel::Stable,
        };
        assert!(pending.verify(Channel::Stable).is_ok());
        assert!(pending.verify(Channel::Nightly).is_err());
        fs::write(path, b"modified package").unwrap();
        assert!(pending.verify(Channel::Stable).is_err());
        fs::remove_dir_all(folder).unwrap();
    }
    #[test]
    fn setup_cache_alias_is_authenticated_and_normalized_before_delta_use() {
        let folder =
            std::env::temp_dir().join(format!("mxplorer-setup-alias-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&folder).unwrap();
        let alias = folder.join("Mxplorer-0.3.1-full.nupkg");
        fs::write(&alias, b"abc").unwrap();
        let signed = VelopackAsset {
            PackageId: "Mxplorer".into(),
            Version: "0.3.1".into(),
            Type: "Full".into(),
            FileName: "Mxplorer-0.3.1-stable-full.nupkg".into(),
            SHA256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad".into(),
            Size: 3,
            ..Default::default()
        };
        let base = VelopackAsset {
            FileName: "Mxplorer-0.3.1-full.nupkg".into(),
            SHA256: String::new(),
            ..signed.clone()
        };
        let result = prepare_base(
            &folder,
            &base,
            std::slice::from_ref(&signed),
            Channel::Stable,
        )
        .expect("a valid Setup cache must support deltas");
        assert_eq!(result.FileName, "Mxplorer-0.3.1-stable-full.nupkg");
        assert_eq!(fs::read(folder.join(&result.FileName)).unwrap(), b"abc");
        fs::write(&alias, b"bad").unwrap();
        assert!(prepare_base(
            &folder,
            &base,
            std::slice::from_ref(&signed),
            Channel::Stable
        )
        .is_none());
        fs::remove_dir_all(folder).unwrap();
    }
    #[cfg(windows)]
    #[test]
    fn reconstructed_cache_alias_uses_canonical_receipt_and_rechecks_candidate_bytes() {
        let folder =
            std::env::temp_dir().join(format!("mxplorer-delta-alias-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&folder).unwrap();
        let signed = VelopackAsset {
            PackageId: "Mxplorer".into(),
            Version: "0.3.1".into(),
            Type: "Full".into(),
            FileName: "Mxplorer-0.3.1-stable-full.nupkg".into(),
            SHA256: "b".repeat(64),
            Size: 123,
            ..Default::default()
        };
        let canonical = folder.join(&signed.FileName);
        fs::write(&canonical, b"authenticated reconstructed ZIP").unwrap();
        receipt::save(&canonical, &signed, Channel::Stable).unwrap();
        let base = VelopackAsset {
            FileName: "Mxplorer-0.3.1-full.nupkg".into(),
            ..signed.clone()
        };
        let alias = folder.join(&base.FileName);
        fs::rename(&canonical, &alias).unwrap();
        assert!(prepare_base(
            &folder,
            &base,
            std::slice::from_ref(&signed),
            Channel::Stable
        )
        .is_some());
        assert!(prepare_base(
            &folder,
            &base,
            std::slice::from_ref(&signed),
            Channel::Nightly
        )
        .is_none());
        fs::write(&alias, b"tampered").unwrap();
        assert!(prepare_base(
            &folder,
            &base,
            std::slice::from_ref(&signed),
            Channel::Stable
        )
        .is_none());
        fs::remove_dir_all(folder).unwrap();
    }
    #[cfg(windows)]
    #[test]
    fn reconstructed_receipt_binds_digest_channel_and_signed_asset() {
        let folder =
            std::env::temp_dir().join(format!("mxplorer-receipt-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&folder).unwrap();
        let path = folder.join("Mxplorer-0.3.0-full.nupkg");
        fs::write(&path, b"recompressed authenticated delta output").unwrap();
        let mut asset = VelopackAsset {
            FileName: "Mxplorer-0.3.0-full.nupkg".into(),
            Version: "0.3.0".into(),
            SHA256: "b".repeat(64),
            ..Default::default()
        };
        receipt::save(&path, &asset, Channel::Stable).unwrap();
        assert!(receipt::verify(&path, &asset, Channel::Stable).is_ok());
        assert!(receipt::verify(&path, &asset, Channel::Nightly).is_err());
        asset.Version = "0.3.1".into();
        assert!(receipt::verify(&path, &asset, Channel::Stable).is_err());
        asset.Version = "0.3.0".into();
        asset.SHA256 = "c".repeat(64);
        assert!(receipt::verify(&path, &asset, Channel::Stable).is_err());
        asset.SHA256 = "b".repeat(64);
        fs::write(&path, b"tampered").unwrap();
        assert!(receipt::verify(&path, &asset, Channel::Stable).is_err());
        fs::remove_dir_all(folder).unwrap();
    }
}
