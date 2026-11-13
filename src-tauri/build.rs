fn main() {
    println!("cargo:rerun-if-env-changed=MXPLORER_CHANNEL");
    println!("cargo:rerun-if-env-changed=MXPLORER_COMMIT");
    println!("cargo:rerun-if-changed=update-public-key.txt");
    tauri_build::build()
}
