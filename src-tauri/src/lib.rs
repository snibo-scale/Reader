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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
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
            storage::get_paper,
            storage::import_paper,
            storage::read_pdf_bytes,
            storage::update_paper,
            storage::set_reading_progress,
            storage::set_highlight_note,
            storage::list_reading_lists,
            storage::save_reading_lists,
            storage::delete_paper,
            storage::import_from_research,
            storage::import_from_url,
            storage::fetch_url,
            storage::import_markdown,
            storage::export_library,
            storage::import_library,
            storage::export_paper,
            storage::import_paper_file,
            ai::ask_ai,
            ai::run_prompt,
            ai::suggest_queries,
            arxiv::arxiv_search,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            // Flush any save still pending from the update_paper debounce.
            if let tauri::RunEvent::Exit = event {
                if let Some(lib) = app.try_state::<Mutex<Library>>() {
                    lib.lock().unwrap().save();
                }
            }
        });
}
