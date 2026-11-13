//! All COM objects remain on WebView2's UI thread. Only plain records cross threads.
use super::cookies::{CookieKey, CookieRecord, SameSite};
use super::*;
use webview2_com::{
    CoTaskMemPWSTR, GetCookiesCompletedHandler, Microsoft::Web::WebView2::Win32::*,
};
use windows::core::{Interface, BOOL, HSTRING, PCWSTR, PWSTR};

unsafe fn manager(
    platform: tauri::webview::PlatformWebview,
) -> windows::core::Result<ICoreWebView2CookieManager> {
    platform
        .controller()
        .CoreWebView2()?
        .cast::<ICoreWebView2_2>()?
        .CookieManager()
}
unsafe fn read(cookie: &ICoreWebView2Cookie) -> windows::core::Result<CookieRecord> {
    let mut name = PWSTR::null();
    cookie.Name(&mut name)?;
    let name = CoTaskMemPWSTR::from(name).to_string();
    let mut value = PWSTR::null();
    cookie.Value(&mut value)?;
    let value = CoTaskMemPWSTR::from(value).to_string();
    let mut domain = PWSTR::null();
    cookie.Domain(&mut domain)?;
    let domain = CoTaskMemPWSTR::from(domain).to_string();
    let mut path = PWSTR::null();
    cookie.Path(&mut path)?;
    let path = CoTaskMemPWSTR::from(path).to_string();
    let mut secure = BOOL(0);
    cookie.IsSecure(&mut secure)?;
    let mut http_only = BOOL(0);
    cookie.IsHttpOnly(&mut http_only)?;
    let mut session = BOOL(0);
    cookie.IsSession(&mut session)?;
    let mut expires = 0.;
    cookie.Expires(&mut expires)?;
    let mut same_site = COREWEBVIEW2_COOKIE_SAME_SITE_KIND_LAX;
    cookie.SameSite(&mut same_site)?;
    Ok(CookieRecord {
        name,
        value,
        host_only: !domain.starts_with('.'),
        domain,
        path,
        secure: secure.as_bool(),
        http_only: http_only.as_bool(),
        same_site: match same_site {
            COREWEBVIEW2_COOKIE_SAME_SITE_KIND_NONE => SameSite::NoRestriction,
            COREWEBVIEW2_COOKIE_SAME_SITE_KIND_STRICT => SameSite::Strict,
            _ => SameSite::Lax,
        },
        session: session.as_bool(),
        expiration_date: if session.as_bool() {
            None
        } else {
            Some(expires)
        },
    })
}
unsafe fn create(
    manager: &ICoreWebView2CookieManager,
    record: &CookieRecord,
) -> windows::core::Result<ICoreWebView2Cookie> {
    let domain = record.domain.trim_start_matches('.');
    let domain = if record.host_only {
        domain.to_owned()
    } else {
        format!(".{domain}")
    };
    let cookie = manager.CreateCookie(
        &HSTRING::from(&record.name),
        &HSTRING::from(&record.value),
        &HSTRING::from(domain),
        &HSTRING::from(&record.path),
    )?;
    cookie.SetIsSecure(record.secure)?;
    cookie.SetIsHttpOnly(record.http_only)?;
    cookie.SetSameSite(match record.same_site {
        SameSite::NoRestriction => COREWEBVIEW2_COOKIE_SAME_SITE_KIND_NONE,
        SameSite::Strict => COREWEBVIEW2_COOKIE_SAME_SITE_KIND_STRICT,
        _ => COREWEBVIEW2_COOKIE_SAME_SITE_KIND_LAX,
    })?;
    // A newly created cookie is a session cookie until Expires is set.
    if !record.session {
        cookie.SetExpires(record.expiration_date.unwrap_or(-1.))?;
    }
    Ok(cookie)
}
async fn receive<T: Send + 'static>(receiver: std::sync::mpsc::Receiver<Result<T>>) -> Result<T> {
    tauri::async_runtime::spawn_blocking(move || {
        receiver
            .recv_timeout(std::time::Duration::from_secs(30))
            .map_err(|_| "Native cookie operation timed out".to_string())?
    })
    .await
    .map_err(|_| "Native cookie operation interrupted".to_string())?
}
pub async fn list(view: &Webview) -> Result<Vec<CookieRecord>> {
    let (sender, receiver) = std::sync::mpsc::channel();
    view.with_webview(move |platform| unsafe {
        let completion = sender.clone();
        let result = (|| -> windows::core::Result<()> {
            manager(platform)?.GetCookies(
                PCWSTR::null(),
                &GetCookiesCompletedHandler::create(Box::new(move |status, list| {
                    let result = (|| -> windows::core::Result<Vec<CookieRecord>> {
                        status?;
                        let list = list.ok_or_else(|| {
                            windows::core::Error::from_hresult(windows::core::HRESULT(
                                0x80004005u32 as i32,
                            ))
                        })?;
                        let mut count = 0;
                        list.Count(&mut count)?;
                        let mut cookies = Vec::with_capacity(count as usize);
                        for index in 0..count {
                            cookies.push(read(&list.GetValueAtIndex(index)?)?);
                        }
                        Ok(cookies)
                    })()
                    .map_err(|_| "Could not read the native cookie store".into());
                    let _ = completion.send(result);
                    Ok(())
                })),
            )
        })();
        if result.is_err() {
            let _ = sender.send(Err("Could not open the native cookie store".into()));
        }
    })
    .map_err(|_| "Native profile unavailable".to_string())?;
    receive(receiver).await
}
pub async fn apply(view: &Webview, records: Vec<CookieRecord>) -> Result {
    let (sender, receiver) = std::sync::mpsc::channel();
    view.with_webview(move |platform| unsafe {
        let result = (|| -> windows::core::Result<()> {
            let manager = manager(platform)?;
            // Construct every native cookie before mutating the profile.
            let cookies = records
                .iter()
                .map(|r| create(&manager, r))
                .collect::<windows::core::Result<Vec<_>>>()?;
            for cookie in cookies {
                manager.AddOrUpdateCookie(&cookie)?;
            }
            Ok(())
        })()
        .map_err(|_| "Could not write the native cookie store".into());
        let _ = sender.send(result);
    })
    .map_err(|_| "Native profile unavailable".to_string())?;
    receive(receiver).await
}
pub async fn delete(view: &Webview, keys: Vec<CookieKey>) -> Result {
    let (sender, receiver) = std::sync::mpsc::channel();
    view.with_webview(move |platform| unsafe {
        let completion = sender.clone();
        let result = (|| -> windows::core::Result<()> {
            let manager = manager(platform)?;
            let deleting = manager.clone();
            manager.GetCookies(
                PCWSTR::null(),
                &GetCookiesCompletedHandler::create(Box::new(move |status, list| {
                    let result = (|| -> windows::core::Result<()> {
                        status?;
                        if let Some(list) = list {
                            let mut count = 0;
                            list.Count(&mut count)?;
                            for index in 0..count {
                                let cookie = list.GetValueAtIndex(index)?;
                                let key = read(&cookie)?.key();
                                if keys.contains(&key) {
                                    deleting.DeleteCookie(&cookie)?;
                                }
                            }
                        }
                        Ok(())
                    })()
                    .map_err(|_| "Could not delete native cookies".into());
                    let _ = completion.send(result);
                    Ok(())
                })),
            )
        })();
        if result.is_err() {
            let _ = sender.send(Err("Could not open the native cookie store".into()));
        }
    })
    .map_err(|_| "Native profile unavailable".to_string())?;
    receive(receiver).await
}
