mod ai;
mod arxiv;
mod storage;

use std::sync::Mutex;
use storage::Library;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            std::fs::create_dir_all(dir.join("papers")).ok();
            let library = Library::load(dir);
            app.manage(Mutex::new(library));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            storage::list_papers,
            storage::import_paper,
            storage::read_pdf_bytes,
            storage::update_paper,
            storage::delete_paper,
            storage::import_from_research,
            storage::import_from_url,
            ai::ask_ai,
            ai::analyze_paper,
            ai::suggest_queries,
            arxiv::arxiv_search,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
