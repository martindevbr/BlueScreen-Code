//! Runtimes e execução: o que cada linguagem precisa instalado (`langs`), a versão que o projeto pede (`require`),
//! os pontos de entrada de um arquivo (`entries`) e como executá-los (`plan`). O servidor do plugin (bin/server.rs)
//! junta isso com o que o núcleo sabe do PC (programas no PATH, JDKs, SDKs baixados).
pub mod entries;
pub mod langs;
pub mod plan;
pub mod require;
