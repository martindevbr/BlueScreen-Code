//! BlueScreen SDK: o que o núcleo e os plugins (programas à parte) compartilham.
//! - `util`: processos, erros de API, arquivos, datas, cache
//! - `vcs`: Git e SVN
//! - `plugin`: tipos das rotas, servidor de plugin (handshake com o núcleo) e cliente do núcleo
//! - `store`: pacote de plugin do servidor de plugins (versões, hash, caminhos)
pub mod plugin;
pub mod store;
pub mod util;
pub mod vcs;
