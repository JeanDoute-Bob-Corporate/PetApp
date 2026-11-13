//! Transport du multijoueur, sans serveur.
//!
//! - **Salon** : le créateur (hôte) écoute en TCP et accepte jusqu'à 7 joueurs ; il
//!   annonce son salon en UDP sur le réseau local (port 47820) toutes les 2 s.
//! - **Recherche** : les autres écoutent ces annonces pour lister les salons proches.
//! - **Code de session court** : IPv4 locale + port TCP en 10 caractères
//!   (« K7Q2M-4XA9P »), utilisable sur le réseau local ou un VPN.
//! - **Messages** : une ligne JSON chacun, relayés tels quels au frontend avec
//!   l'identifiant de la connexion (le frontend les valide : pairs non fiables).
//!
//! Rien n'écoute tant que l'utilisateur n'a ni créé de salon ni lancé de recherche, et
//! une connexion entrante n'est acceptée que si un salon est ouvert.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Ipv4Addr, Shutdown, SocketAddr, SocketAddrV4, TcpListener, TcpStream, UdpSocket};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::state::lock;

const DISCOVERY_PORT: u16 = 47820;
const ANNOUNCE_EVERY: Duration = Duration::from_secs(2);
const ROOM_TIMEOUT: Duration = Duration::from_secs(7);
/// Les migrations transportent l'apparence du compagnon (planche PNG en base64).
const MAX_LINE_BYTES: usize = 4 * 1024 * 1024;
/// Un salon : l'hôte + 7 joueurs.
const MAX_CONNECTIONS: usize = 7;
const MAGIC: &str = "DCMP2 ";
/// Alphabet de Crockford (sans I, L, O, U : pas de confusion à la saisie).
const CODE_ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/// Salon annoncé sur le réseau local.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RoomInfo {
    pub id: String,
    pub name: String,
    pub address: String,
    pub players: u32,
}

#[derive(Serialize, Deserialize)]
struct Announce {
    id: String,
    name: String,
    port: u16,
    players: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct P2pStatus {
    pub hosting: bool,
    pub browsing: bool,
    pub code: Option<String>,
    pub connections: usize,
}

#[derive(Default)]
struct Inner {
    my_id: String,
    my_name: String,
    players: u32,
    port: Option<u16>,
    rooms: HashMap<String, (RoomInfo, Instant)>,
    /// Flux d'écriture de chaque connexion, par identifiant.
    conns: HashMap<u32, TcpStream>,
}

pub struct P2pState {
    inner: Mutex<Inner>,
    hosting: AtomicBool,
    browsing: AtomicBool,
    listener_started: AtomicBool,
    discovery_started: AtomicBool,
    next_conn: AtomicU32,
}

impl P2pState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(Inner {
                my_id: format!("{:016x}", random_u64()),
                my_name: "Compagnon".into(),
                players: 1,
                ..Default::default()
            }),
            hosting: AtomicBool::new(false),
            browsing: AtomicBool::new(false),
            listener_started: AtomicBool::new(false),
            discovery_started: AtomicBool::new(false),
            next_conn: AtomicU32::new(1),
        }
    }
}

impl Default for P2pState {
    fn default() -> Self {
        Self::new()
    }
}

fn random_u64() -> u64 {
    use std::hash::{BuildHasher, Hasher};
    let mut h = std::collections::hash_map::RandomState::new().build_hasher();
    h.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
    h.write_u32(std::process::id());
    h.finish()
}

// --- Code de session --------------------------------------------------------------

/// Adresse IPv4 de l'interface réseau sortante (aucun paquet n'est envoyé :
/// `connect` sur UDP ne fait que choisir la route).
fn local_ipv4() -> Ipv4Addr {
    UdpSocket::bind("0.0.0.0:0")
        .and_then(|s| {
            s.connect("192.0.2.1:9")?; // adresse de documentation, jamais contactée
            s.local_addr()
        })
        .ok()
        .and_then(|a| match a.ip() {
            std::net::IpAddr::V4(ip) if !ip.is_unspecified() => Some(ip),
            _ => None,
        })
        .unwrap_or(Ipv4Addr::LOCALHOST)
}

pub fn encode_code(ip: Ipv4Addr, port: u16) -> String {
    let o = ip.octets();
    let mut n = u64::from_be_bytes([0, 0, o[0], o[1], o[2], o[3], (port >> 8) as u8, port as u8]);
    let mut chars = [b'0'; 10];
    for c in chars.iter_mut().rev() {
        *c = CODE_ALPHABET[(n & 31) as usize];
        n >>= 5;
    }
    let s = String::from_utf8_lossy(&chars).to_string();
    format!("{}-{}", &s[..5], &s[5..])
}

pub fn decode_code(code: &str) -> Option<SocketAddrV4> {
    let mut n: u64 = 0;
    let mut count = 0;
    for c in code.chars().filter(|c| !matches!(c, '-' | ' ')) {
        let c = c.to_ascii_uppercase();
        // Tolérance de saisie : O → 0, I/L → 1.
        let c = match c {
            'O' => '0',
            'I' | 'L' => '1',
            other => other,
        };
        let v = CODE_ALPHABET.iter().position(|&a| a == c as u8)? as u64;
        n = (n << 5) | v;
        count += 1;
    }
    if count != 10 || n >> 48 != 0 {
        return None;
    }
    let b = n.to_be_bytes();
    let port = u16::from_be_bytes([b[6], b[7]]);
    if port == 0 {
        return None;
    }
    Some(SocketAddrV4::new(Ipv4Addr::new(b[2], b[3], b[4], b[5]), port))
}

// --- API (commandes) -----------------------------------------------------------------

pub fn status(state: &P2pState) -> P2pStatus {
    let inner = lock(&state.inner);
    let hosting = state.hosting.load(Ordering::Relaxed);
    P2pStatus {
        hosting,
        browsing: state.browsing.load(Ordering::Relaxed),
        code: if hosting { inner.port.map(|p| encode_code(local_ipv4(), p)) } else { None },
        connections: inner.conns.len(),
    }
}

/// Ouvre (ou met à jour) / ferme le salon dont on est l'hôte.
pub fn host(app: &AppHandle, state: &Arc<P2pState>, open: bool, name: &str, players: u32) -> Result<P2pStatus, String> {
    {
        let mut inner = lock(&state.inner);
        inner.my_name = name.chars().take(32).collect();
        inner.players = players.clamp(1, 8);
    }
    state.hosting.store(open, Ordering::Relaxed);
    if open {
        if !state.listener_started.swap(true, Ordering::Relaxed) {
            let listener = TcpListener::bind("0.0.0.0:0").map_err(|e| format!("écoute impossible : {e}"))?;
            lock(&state.inner).port = Some(listener.local_addr().map_err(|e| e.to_string())?.port());
            spawn_listener(app.clone(), Arc::clone(state), listener);
        }
        ensure_discovery(app, state);
    }
    Ok(status(state))
}

/// Recherche des salons du réseau local (sans en ouvrir).
pub fn browse(app: &AppHandle, state: &Arc<P2pState>, on: bool) -> P2pStatus {
    state.browsing.store(on, Ordering::Relaxed);
    if on {
        ensure_discovery(app, state);
    } else {
        lock(&state.inner).rooms.clear();
        let _ = app.emit("p2p-rooms", Vec::<RoomInfo>::new());
    }
    status(state)
}

/// Rejoint un salon : identifiant d'un salon découvert, ou code de session.
/// Renvoie l'identifiant de la connexion.
pub fn connect(app: &AppHandle, state: &Arc<P2pState>, target: &str) -> Result<u32, String> {
    let addr: SocketAddr = {
        let inner = lock(&state.inner);
        match inner.rooms.get(target) {
            Some((room, _)) => room.address.parse().map_err(|_| "adresse de salon invalide".to_string())?,
            None => SocketAddr::V4(decode_code(target).ok_or("code de session invalide")?),
        }
    };
    let stream = TcpStream::connect_timeout(&addr, Duration::from_secs(4))
        .map_err(|e| format!("connexion à {addr} impossible : {e}"))?;
    attach(app, state, stream, true)
}

pub fn send(state: &P2pState, conn: u32, message: &str) -> Result<(), String> {
    if message.len() > MAX_LINE_BYTES || message.contains('\n') {
        return Err("message invalide".into());
    }
    let mut inner = lock(&state.inner);
    let stream = inner.conns.get_mut(&conn).ok_or("connexion inconnue")?;
    let result = stream.write_all(message.as_bytes()).and_then(|()| stream.write_all(b"\n"));
    result.map_err(|e| format!("envoi impossible : {e}"))
}

/// Ferme une connexion (`None` : toutes).
pub fn close(state: &P2pState, conn: Option<u32>) {
    let mut inner = lock(&state.inner);
    let ids: Vec<u32> = match conn {
        Some(id) => vec![id],
        None => inner.conns.keys().copied().collect(),
    };
    for id in ids {
        if let Some(stream) = inner.conns.remove(&id) {
            // Le lecteur de cette connexion verra la fin du flux et émettra la déconnexion.
            let _ = stream.shutdown(Shutdown::Both);
        }
    }
}

// --- Connexions -----------------------------------------------------------------------

fn attach(app: &AppHandle, state: &Arc<P2pState>, stream: TcpStream, initiator: bool) -> Result<u32, String> {
    let address = stream.peer_addr().map(|a| a.to_string()).unwrap_or_default();
    let _ = stream.set_nodelay(true);
    let reader = stream.try_clone().map_err(|e| e.to_string())?;
    let id = state.next_conn.fetch_add(1, Ordering::Relaxed);
    {
        let mut inner = lock(&state.inner);
        if inner.conns.len() >= MAX_CONNECTIONS {
            let _ = stream.shutdown(Shutdown::Both);
            return Err("salon complet".into());
        }
        inner.conns.insert(id, stream);
    }
    let _ = app.emit("p2p-connected", serde_json::json!({ "conn": id, "address": address, "initiator": initiator }));

    let app = app.clone();
    let state = Arc::clone(state);
    thread::Builder::new()
        .name(format!("p2p-reader-{id}"))
        .spawn(move || {
            let mut lines = BufReader::new(reader);
            let mut line = Vec::new();
            loop {
                line.clear();
                // Lecture bornée : un pair ne peut pas nous faire allouer sans limite.
                match (&mut lines).take(MAX_LINE_BYTES as u64 + 1).read_until(b'\n', &mut line) {
                    Ok(0) => break,
                    Ok(_) if line.len() > MAX_LINE_BYTES => break,
                    Ok(_) => {
                        if let Ok(text) = std::str::from_utf8(&line) {
                            let text = text.trim_end();
                            if !text.is_empty() {
                                let _ = app.emit("p2p-message", serde_json::json!({ "conn": id, "text": text }));
                            }
                        }
                    }
                    Err(_) => break,
                }
            }
            if let Some(stream) = lock(&state.inner).conns.remove(&id) {
                let _ = stream.shutdown(Shutdown::Both);
            }
            let _ = app.emit("p2p-disconnected", serde_json::json!({ "conn": id }));
        })
        .map_err(|e| e.to_string())?;
    Ok(id)
}

fn spawn_listener(app: AppHandle, state: Arc<P2pState>, listener: TcpListener) {
    let _ = thread::Builder::new().name("p2p-listener".into()).spawn(move || {
        for stream in listener.incoming().flatten() {
            if !state.hosting.load(Ordering::Relaxed) {
                let _ = stream.shutdown(Shutdown::Both);
                continue;
            }
            if let Err(e) = attach(&app, &state, stream, false) {
                eprintln!("[p2p] connexion entrante refusée : {e}");
            }
        }
    });
}

// --- Découverte LAN -------------------------------------------------------------------

fn discovery_socket() -> std::io::Result<UdpSocket> {
    use socket2::{Domain, Protocol, Socket, Type};
    let socket = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP))?;
    // Plusieurs instances (et applications) peuvent écouter les annonces.
    socket.set_reuse_address(true)?;
    socket.set_broadcast(true)?;
    socket.bind(&SocketAddr::from(([0, 0, 0, 0], DISCOVERY_PORT)).into())?;
    let socket: UdpSocket = socket.into();
    socket.set_read_timeout(Some(Duration::from_millis(500)))?;
    Ok(socket)
}

fn ensure_discovery(app: &AppHandle, state: &Arc<P2pState>) {
    if state.discovery_started.swap(true, Ordering::Relaxed) {
        return;
    }
    let app = app.clone();
    let state = Arc::clone(state);
    let _ = thread::Builder::new().name("p2p-discovery".into()).spawn(move || {
        let socket = match discovery_socket() {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[p2p] découverte LAN indisponible : {e}");
                return;
            }
        };
        let mut last_announce = Instant::now() - ANNOUNCE_EVERY;
        let mut last_sent: Vec<RoomInfo> = Vec::new();
        let mut buf = [0u8; 512];
        loop {
            let hosting = state.hosting.load(Ordering::Relaxed);
            let browsing = state.browsing.load(Ordering::Relaxed);
            if !hosting && !browsing {
                thread::sleep(Duration::from_millis(500));
                continue;
            }
            if hosting && last_announce.elapsed() >= ANNOUNCE_EVERY {
                let announce = {
                    let inner = lock(&state.inner);
                    Announce {
                        id: inner.my_id.clone(),
                        name: inner.my_name.clone(),
                        port: inner.port.unwrap_or(0),
                        players: inner.players,
                    }
                };
                let msg = format!("{MAGIC}{}", serde_json::json!(announce));
                let _ = socket.send_to(msg.as_bytes(), (Ipv4Addr::BROADCAST, DISCOVERY_PORT));
                // Même machine (instance de test) : la diffusion ne revient pas toujours.
                let _ = socket.send_to(msg.as_bytes(), (Ipv4Addr::LOCALHOST, DISCOVERY_PORT));
                last_announce = Instant::now();
            }
            if let Ok((n, from)) = socket.recv_from(&mut buf) {
                if browsing {
                    let text = String::from_utf8_lossy(&buf[..n]);
                    if let Some(a) = text.strip_prefix(MAGIC).and_then(|j| serde_json::from_str::<Announce>(j).ok()) {
                        let mut inner = lock(&state.inner);
                        if a.id != inner.my_id && a.port != 0 && a.name.chars().count() <= 32 {
                            let room = RoomInfo {
                                id: a.id.clone(),
                                name: a.name,
                                address: SocketAddr::new(from.ip(), a.port).to_string(),
                                players: a.players.min(8),
                            };
                            inner.rooms.insert(a.id, (room, Instant::now()));
                        }
                    }
                }
            }
            if browsing {
                let rooms: Vec<RoomInfo> = {
                    let mut inner = lock(&state.inner);
                    inner.rooms.retain(|_, (_, seen)| seen.elapsed() < ROOM_TIMEOUT);
                    let mut v: Vec<RoomInfo> = inner.rooms.values().map(|(r, _)| r.clone()).collect();
                    v.sort_by(|a, b| a.name.cmp(&b.name).then(a.id.cmp(&b.id)));
                    v
                };
                if rooms != last_sent {
                    let _ = app.emit("p2p-rooms", &rooms);
                    last_sent = rooms;
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_code_round_trip() {
        let ip = Ipv4Addr::new(192, 168, 1, 23);
        let code = encode_code(ip, 51234);
        assert_eq!(code.len(), 11);
        assert_eq!(decode_code(&code), Some(SocketAddrV4::new(ip, 51234)));
        // Saisie tolérante : minuscules, sans tiret, O à la place de 0.
        let sloppy = code.replace('-', "").to_lowercase().replace('0', "o");
        assert_eq!(decode_code(&sloppy), Some(SocketAddrV4::new(ip, 51234)));
    }

    #[test]
    fn invalid_codes_are_rejected() {
        assert_eq!(decode_code(""), None);
        assert_eq!(decode_code("ABC"), None);
        assert_eq!(decode_code("UUUUU-UUUUU"), None); // U n'existe pas dans l'alphabet
    }
}
