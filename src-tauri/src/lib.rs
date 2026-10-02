pub mod convert;
pub mod document;
pub mod ebook;
pub mod edit;
pub mod edit_ext;
pub mod error;
pub mod forms;
pub mod ocr;
pub mod office;
pub mod pages;
pub mod reader;
pub mod render;
pub mod security;
pub mod watermark;
pub mod watermark_remove;

pub use document::pdfium;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(document::AppState::default())
        .invoke_handler(tauri::generate_handler![
            document::open_document,
            document::close_document,
            document::get_metadata,
            document::save_document,
            document::undo_document,
            document::can_undo,
            document::undo_depth,
            document::redo_document,
            document::can_redo,
            document::redo_depth,
            render::render_page,
            render::render_thumbnail,
            render::get_page_text,
            render::search_page_text,
            render::pick_text_at_point,
            reader::read_text_doc,
            pages::rotate_pages,
            pages::delete_pages,
            pages::duplicate_pages,
            pages::insert_blank_page,
            pages::reorder_pages,
            pages::extract_pages,
            pages::merge_documents,
            pages::inspect_merge_sources,
            pages::split_document,
            pages::get_bookmarks,
            watermark::add_text_watermark,
            watermark::add_image_watermark,
            watermark_remove::remove_objects_in_rect,
            watermark_remove::detect_watermark_candidates,
            watermark_remove::apply_watermark_removal,
            edit::list_annotations,
            edit::add_annotation,
            edit::delete_annotation,
            edit::clear_annotations,
            edit_ext::rewrite_text,
            edit_ext::add_text_box,
            edit_ext::replace_image,
            edit_ext::delete_image_object,
            edit_ext::list_image_objects,
            edit_ext::set_image_bounds,
            edit_ext::is_scanned_page,
            edit_ext::clear_page_text,
            security::get_security_status,
            security::export_plain_copy,
            security::export_encrypted_copy,
            security::reload_plain,
            convert::export_pages_to_images,
            convert::images_to_pdf,
            office::detect_office,
            office::convert_office_to_pdf,
            ebook::detect_ebook_tools,
            ebook::convert_ebook_to_pdf,
            ocr::ocr_page,
            ocr::ocr_apply_text_overlay,
            forms::list_form_fields,
            forms::set_form_field_value
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
