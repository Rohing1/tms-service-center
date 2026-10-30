#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::{sync::{atomic::{AtomicU64, Ordering}, Mutex}, time::Duration};
use tauri::{menu::{Menu, MenuItem, PredefinedMenuItem, Submenu}, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use url::Url;

#[derive(Clone, Default, Serialize, Deserialize)]
struct Settings { servers: Vec<Server> }
#[derive(Clone, Serialize, Deserialize)]
struct Server { name: String, address: String }
#[derive(Default)]
struct ClientState { active: Mutex<Option<String>>, settings_lock: Mutex<()> }
static WINDOW_ID: AtomicU64 = AtomicU64::new(1);

fn normalize_address(value: &str) -> Result<Url, String> {
    let url = Url::parse(value.trim()).map_err(|_| "请输入完整地址，例如 https://panel.example.com".to_string())?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() || !url.username().is_empty() || url.password().is_some() {
        return Err("仅支持 HTTP / HTTPS 面板地址，地址中不能包含账号或密码".into());
    }
    if url.path() != "/" || url.query().is_some() || url.fragment().is_some() {
        return Err("请填写面板首页地址，不要附带 /api、页面路径或订阅参数".into());
    }
    Ok(url)
}

// Application commands are only callable by the bundled settings page.
// The server webview gets no filesystem, shell or application IPC authority.
fn local_only(window: &WebviewWindow) -> Result<(), String> {
    let url = window.url().map_err(|_| "无法识别窗口来源")?;
    if window.label() == "settings" && is_settings_origin(&url) {
        Ok(())
    } else { Err("此窗口不能访问桌面设置".into()) }
}
fn is_settings_origin(url: &Url) -> bool {
    (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
        || (matches!(url.scheme(), "http" | "https") && url.host_str() == Some("tauri.localhost"))
}

fn settings_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|_| "无法访问配置目录")?;
    std::fs::create_dir_all(&dir).map_err(|_| "无法创建配置目录")?;
    Ok(dir.join("servers.json"))
}
fn read_settings(app: &tauri::AppHandle) -> Result<Settings, String> {
    let path = settings_path(app)?;
    if !path.exists() { return Ok(Settings::default()); }
    serde_json::from_slice(&std::fs::read(path).map_err(|_| "无法读取服务器列表")?).map_err(|_| "服务器列表文件损坏，请检查配置目录中的 servers.json".into())
}
fn write_settings(app: &tauri::AppHandle, settings: &Settings) -> Result<(), String> {
    let path = settings_path(app)?;
    let temp = path.with_extension("tmp");
    std::fs::write(&temp, serde_json::to_vec_pretty(settings).map_err(|_| "无法保存服务器列表")?).map_err(|_| "无法写入服务器列表")?;
    std::fs::rename(temp, path).map_err(|_| "无法更新服务器列表".into())
}

#[tauri::command]
fn get_settings(window: WebviewWindow, app: tauri::AppHandle) -> Result<Settings, String> {
    local_only(&window)?;
    read_settings(&app)
}
#[tauri::command]
fn save_server(window: WebviewWindow, app: tauri::AppHandle, name: String, address: String) -> Result<Settings, String> {
    local_only(&window)?;
    let address = normalize_address(&address)?.to_string();
    let name = name.trim().to_string();
    if name.is_empty() || name.chars().count() > 60 { return Err("服务器名称需为 1–60 个字符".into()); }
    let state = app.state::<ClientState>();
    let _lock = state.settings_lock.lock().map_err(|_| "设置正忙")?;
    let mut settings = read_settings(&app)?;
    settings.servers.retain(|s| s.address != address);
    if settings.servers.len() >= 20 { return Err("最多保存 20 个服务器，请先移除不再使用的地址".into()); }
    settings.servers.insert(0, Server { name, address });
    write_settings(&app, &settings)?;
    Ok(settings)
}
#[tauri::command]
fn remove_server(window: WebviewWindow, app: tauri::AppHandle, address: String) -> Result<Settings, String> {
    local_only(&window)?;
    let state = app.state::<ClientState>();
    let _lock = state.settings_lock.lock().map_err(|_| "设置正忙")?;
    let mut settings = read_settings(&app)?;
    settings.servers.retain(|s| s.address != address);
    write_settings(&app, &settings)?;
    Ok(settings)
}

fn show_settings(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("settings") { let _ = window.show(); let _ = window.set_focus(); }
}

async fn check_connection(url: &Url) -> Result<(), String> {
    let redirect_origin = url.origin();
    let client = reqwest::Client::builder().timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::custom(move |attempt| {
            if attempt.previous().len() > 5 || attempt.url().origin() != redirect_origin { attempt.stop() } else { attempt.follow() }
        })).build().map_err(|_| "无法启动连接检查")?;
    let response = client.get(url.clone()).send().await.map_err(|e| {
        if e.is_timeout() { "连接超时，请检查服务器地址和网络" }
        else if e.is_connect() { "无法连接服务器，请检查地址、端口和 HTTPS 证书" }
        else { "连接失败，请检查网络和服务器 HTTPS 证书" }.to_string()
    })?;
    if !response.status().is_success() { return Err(format!("服务器返回 HTTP {}，请填写可访问的面板首页地址", response.status().as_u16())); }
    if !response.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("").contains("text/html") {
        return Err("此地址没有返回面板网页，请填写前端地址，而非后台 API 地址".into());
    }
    Ok(())
}

#[tauri::command]
async fn connect_server(window: WebviewWindow, app: tauri::AppHandle, address: String, name: String) -> Result<(), String> {
    local_only(&window)?;
    let url = normalize_address(&address)?;
    check_connection(&url).await?;
    let origin = url.origin();
    let label = format!("panel-{}", WINDOW_ID.fetch_add(1, Ordering::Relaxed));
    let title = if name.trim().is_empty() { "TMS Desktop".to_string() } else { format!("TMS · {}", name.chars().take(60).collect::<String>()) };
    let panel = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(url))
        .title(title).inner_size(1280.0, 840.0).min_inner_size(850.0, 600.0)
        .on_navigation(move |next| next.origin() == origin)
        .on_new_window(|url, _| {
            // Browser handles external links; never grant desktop privileges to a popup.
            if matches!(url.scheme(), "http" | "https") { let _ = open::that(url.as_str()); }
            tauri::webview::NewWindowResponse::Deny
        })
        .build().map_err(|_| "无法打开面板窗口，请检查 WebView 运行环境")?;
    let previous = app.state::<ClientState>().active.lock().map_err(|_| "窗口正忙")?.replace(label.clone());
    if let Some(previous) = previous { if let Some(old) = app.get_webview_window(&previous) { let _ = old.close(); } }
    let handle = app.clone();
    panel.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            if let Ok(mut active) = handle.state::<ClientState>().active.lock() {
                if active.as_deref() == Some(&label) { *active = None; show_settings(&handle); }
            }
        }
    });
    let _ = window.hide();
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .manage(ClientState::default())
        .plugin(tauri_plugin_single_instance::init(|app, _, _| { show_settings(app); }))
        .invoke_handler(tauri::generate_handler![get_settings, save_server, remove_server, connect_server])
        .setup(|app| {
            let settings = MenuItem::with_id(app, "settings", "服务器设置…", true, Some("CmdOrCtrl+,"))?;
            let reload = MenuItem::with_id(app, "reload", "刷新面板", true, Some("CmdOrCtrl+R"))?;
            let browser = MenuItem::with_id(app, "browser", "在浏览器中打开", true, None::<&str>)?;
            let quit = PredefinedMenuItem::quit(app, Some("退出 TMS"))?;
            let submenu = Submenu::with_items(app, "TMS", true, &[&settings, &reload, &browser, &PredefinedMenuItem::separator(app)?, &quit])?;
            let edit = Submenu::with_items(app, "编辑", true, &[
                &PredefinedMenuItem::undo(app, Some("撤销"))?, &PredefinedMenuItem::redo(app, Some("重做"))?,
                &PredefinedMenuItem::cut(app, Some("剪切"))?, &PredefinedMenuItem::copy(app, Some("复制"))?,
                &PredefinedMenuItem::paste(app, Some("粘贴"))?, &PredefinedMenuItem::select_all(app, Some("全选"))?
            ])?;
            app.set_menu(Menu::with_items(app, &[&submenu, &edit])?)?;
            app.on_menu_event(|app, event| {
                if event.id().as_ref() == "settings" { show_settings(app); return; }
                let label = app.state::<ClientState>().active.lock().ok().and_then(|v| v.clone());
                if let Some(panel) = label.and_then(|label| app.get_webview_window(&label)) {
                    match event.id().as_ref() {
                        "reload" => { let _ = panel.reload(); }
                        "browser" => { if let Ok(url) = panel.url() { if matches!(url.scheme(), "http" | "https") { let _ = open::that(url.as_str()); } } }
                        _ => {}
                    }
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "settings" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    if window.state::<ClientState>().active.lock().map(|v| v.is_some()).unwrap_or(false) { api.prevent_close(); let _ = window.hide(); }
                }
            }
        })
        .run(tauri::generate_context!()).expect("TMS desktop startup failed");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    fn serve_once(response: &'static str) -> Url {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
            let mut request = [0; 4096]; let _ = stream.read(&mut request);
            stream.write_all(response.as_bytes()).unwrap();
        });
        Url::parse(&format!("http://{address}/")).unwrap()
    }
    #[test] fn panel_addresses_are_normalized() {
        assert_eq!(normalize_address(" https://panel.example.com ").unwrap().as_str(), "https://panel.example.com/");
        assert!(normalize_address("http://127.0.0.1:6366").is_ok());
        assert!(normalize_address("http://[::1]:6366").is_ok());
    }
    #[test] fn unsafe_or_wrong_endpoint_addresses_are_rejected() {
        for value in ["file:///C:/", "javascript:alert(1)", "https://user:secret@example.com", "https://example.com/api/v1", "https://example.com/?token=secret", "https://example.com/#/login", "panel.example.com"] {
            assert!(normalize_address(value).is_err(), "accepted {value}");
        }
    }
    #[test] fn remote_pages_cannot_impersonate_settings_origin() {
        for url in ["tauri://localhost/", "http://tauri.localhost/", "https://tauri.localhost/"] { assert!(is_settings_origin(&Url::parse(url).unwrap())); }
        for url in ["https://localhost/", "tauri://evil/", "file://localhost/C:/", "https://tauri.localhost.example.com/"] { assert!(!is_settings_origin(&Url::parse(url).unwrap())); }
    }
    #[test] fn html_panel_connection_is_accepted() {
        let url = serve_once("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        assert!(tauri::async_runtime::block_on(check_connection(&url)).is_ok());
    }
    #[test] fn api_address_is_rejected() {
        let url = serve_once("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        assert!(tauri::async_runtime::block_on(check_connection(&url)).unwrap_err().contains("前端地址"));
    }
    #[test] fn cross_origin_redirect_is_not_followed() {
        let url = serve_once("HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:1/\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        assert!(tauri::async_runtime::block_on(check_connection(&url)).unwrap_err().contains("HTTP 302"));
    }
    #[test] fn unavailable_server_has_actionable_error() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = Url::parse(&format!("http://{}/", listener.local_addr().unwrap())).unwrap();
        drop(listener);
        assert!(tauri::async_runtime::block_on(check_connection(&url)).unwrap_err().contains("无法连接服务器"));
    }
}
