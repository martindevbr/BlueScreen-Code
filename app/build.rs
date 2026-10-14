// Ícone e metadados do executável (Windows).
fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=../assets/bluescreen.ico");
    #[cfg(windows)]
    {
        let mut res = winresource::WindowsResource::new();
        res.set_icon("../assets/bluescreen.ico");
        res.set("ProductName", "BlueScreen");
        res.set("FileDescription", "BlueScreen");
        let _ = res.compile();
    }
}
