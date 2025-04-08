// Import Firebase modules
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.5.0/firebase-app.js";
import { getDatabase, ref, set, update, onValue, get } from "https://www.gstatic.com/firebasejs/11.5.0/firebase-database.js";

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBd2O4MWVNlY5MOVffdcvMrkj2lLxJcdv0",
  authDomain: "cactus-game-12ae9.firebaseapp.com",
  projectId: "cactus-game-12ae9",
  storageBucket: "cactus-game-12ae9.appspot.com",
  messagingSenderId: "852427558969",
  appId: "1:852427558969:web:0b292c74c6305dc348fde8",
  databaseURL: "https://cactus-game-12ae9-default-rtdb.firebaseio.com/"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// Variables globales de l'état du jeu
let roomId = null;
let username = null;
let isHost = false;
let playerIndex = null;       // Index numérique attribué à chaque joueur (1, 2, …)
let playerCount = 0;
let playersData = {};         // Données des joueurs depuis Firebase
let playersByIndex = {};      // Mapping : index -> nom
let currentPlayerIndex = null;
let cardCount = 4;
let startVisibleCount = 2;
let targetScore = 3;
let currentRound = 1;
let gameStarted = false;
let drawnCard = null;
let currentDiscard = null;
// Pour effets spéciaux
let specialAction = false;
let pendingSpecial = null;
let selectedForSwap = null;
let cactusDeclared = false;
let cactusPlayerIndex = null;

// Pour maintenir la connexion
// (Ici simple utilisation de sessionStorage pour l'identifiant et roomId)

// UTILITAIRES

function logAction(msg) {
  const logDiv = document.getElementById("log");
  if (logDiv) {
    logDiv.innerHTML += `<p>${msg}</p>`;
  }
  console.log(msg);
}

function getCardValue(card) {
  if (card === "R") return 0;
  if (card === "A") return 1;
  if (card === 2) return -2;
  if (["V", "D", 10].includes(card)) return 10;
  return parseInt(card);
}

function getHandSum(hand) {
  return hand.reduce((s, c) => s + getCardValue(c), 0);
}

// MISE À JOUR DE L'AFFICHAGE

// Met à jour le scoreboard avec les scores et le numéro de manche
function updateScoreboard() {
  let boardHTML = "<strong>Scores</strong>";
  for (let i = 1; i <= playerCount; i++) {
    const name = playersByIndex[i];
    if (!name) continue;
    const score = playersData[name]?.score ?? 0;
    boardHTML += `<br>${name} : ${score}`;
  }
  boardHTML += `<div class="round-info">Manche : ${currentRound}</div>`;
  document.getElementById("scoreboard").innerHTML = boardHTML;
}

// Affiche l'aire de jeu avec toutes les mains
function renderGameArea() {
  const area = document.getElementById("game-area");
  if (!area) return;
  area.innerHTML = "";
  // Pour chaque joueur, afficher son nom et ses cartes (face cachée, sauf si révélées par effet)
  for (let i = 1; i <= playerCount; i++) {
    const name = playersByIndex[i];
    if (!name) continue;
    const hand = playersData[name]?.hand || [];
    const playerDiv = document.createElement("div");
    playerDiv.className = "player-area";
    const label = document.createElement("h3");
    label.textContent = (name === username) ? `${name} (Vous)` : name;
    playerDiv.appendChild(label);
    hand.forEach((card, idx) => {
      const wrapper = document.createElement("div");
      wrapper.className = "card-wrapper";
      const cardEl = document.createElement("div");
      cardEl.className = "card";
      // Par défaut, affiche "?" (carte cachée)
      cardEl.innerText = "?";
      cardEl.dataset.player = String(playersData[name].index);
      cardEl.dataset.index = String(idx);
      cardEl.addEventListener("click", onCardClick);
      wrapper.appendChild(cardEl);
      playerDiv.appendChild(wrapper);
    });
    area.appendChild(playerDiv);
  }
  updateScoreboard();
}

// Met à jour l'indicateur de tour
function updateTurnUI() {
  const turnInfo = document.getElementById("turn-info");
  if (turnInfo) {
    const name = playersByIndex[currentPlayerIndex] || `Joueur ${currentPlayerIndex}`;
    turnInfo.innerText = "Tour de " + name;
  }
}

// Gestionnaire de clic sur une carte
function onCardClick(event) {
  const cardEl = event.currentTarget;
  const player = parseInt(cardEl.dataset.player);
  const index = parseInt(cardEl.dataset.index);
  if (isNaN(player) || isNaN(index) || !playersData) return;
  const playerName = playersByIndex[player];
  const hand = playersData[playerName]?.hand;
  if (!hand) return;
  
  // Traitement des effets spéciaux
  if (specialAction && pendingSpecial === 8 && player === currentPlayerIndex) {
    if (selectedForSwap !== null) return;
    selectedForSwap = true;
    const val = hand[index];
    cardEl.innerText = val;
    logAction("👁 Effet 8 : Carte révélée : " + val);
    setTimeout(() => {
      cardEl.innerText = "?";
      selectedForSwap = null;
      skipSpecial();
    }, 5000);
    return;
  }
  if (specialAction && pendingSpecial === 10 && player !== currentPlayerIndex) {
    if (selectedForSwap !== null) return;
    selectedForSwap = true;
    const val = hand[index];
    cardEl.innerText = val;
    logAction("🔎 Effet 10 : Carte adverse révélée : " + val);
    setTimeout(() => {
      cardEl.innerText = "?";
      selectedForSwap = null;
      skipSpecial();
    }, 5000);
    return;
  }
  if (specialAction && pendingSpecial === "V") {
    // Pour l'effet Valet : si on a sélectionné une carte dans sa main, puis l'autre dans un adversaire pour échange
    if (!selectedForSwap && player === currentPlayerIndex) {
      selectedForSwap = { player, index };
      logAction("👉 Sélectionnez une carte adverse pour échanger.");
      return;
    }
    if (selectedForSwap && player !== currentPlayerIndex) {
      // Échange les cartes entre selectedForSwap et cette carte
      const hostName = playersByIndex[selectedForSwap.player];
      const oppName = playersByIndex[player];
      const myHand = [...playersData[hostName].hand];
      const oppHand = [...playersData[oppName].hand];
      const temp = myHand[selectedForSwap.index];
      myHand[selectedForSwap.index] = oppHand[index];
      oppHand[index] = temp;
      const updates = {};
      updates[`games/${roomId}/players/${hostName}/hand`] = myHand;
      updates[`games/${roomId}/players/${oppName}/hand`] = oppHand;
      update(ref(db), updates);
      selectedForSwap = null;
      logAction("🔄 Effet Valet : Cartes échangées.");
      skipSpecial();
      return;
    }
  }
  
  // Si aucun effet spécial et que c'est votre tour et que vous avez une carte piochée
  if (player === currentPlayerIndex && drawnCard !== null) {
    // Remplacer la carte cliquée par la carte piochée et envoyer l'ancienne à la défausse
    const currentPlayerName = playersByIndex[currentPlayerIndex];
    const handArr = playersData[currentPlayerName].hand;
    const oldCard = handArr[index];
    handArr[index] = drawnCard;
    set(ref(db, `games/${roomId}/players/${currentPlayerName}/hand`), handArr);
    // Mettre à jour la défausse dans la DB
    set(ref(db, `games/${roomId}/discard`), oldCard);
    logAction(`🔄 Carte échangée : ${oldCard} ↔ ${drawnCard}`);
    drawnCard = null;
    handleSpecialCard(oldCard);
  }
}

// Vérifie si une carte défaussée déclenche un effet spécial
function handleSpecialCard(card) {
  specialAction = false;
  pendingSpecial = null;
  if (card === 8) {
    specialAction = true;
    pendingSpecial = 8;
    document.getElementById("skip-special").style.display = "inline-block";
    logAction("👁 Effet spécial (8) : Regardez une de vos cartes.");
    return true;
  }
  if (card === 10) {
    specialAction = true;
    pendingSpecial = 10;
    document.getElementById("skip-special").style.display = "inline-block";
    logAction("🔎 Effet spécial (10) : Regardez une carte adverse.");
    return true;
  }
  if (card === "V") {
    specialAction = true;
    pendingSpecial = "V";
    document.getElementById("skip-special").style.display = "inline-block";
    logAction("🔄 Effet spécial (Valet) : Échangez une de vos cartes avec un adversaire.");
    return true;
  }
  return false;
}

// "Skip special" permet d'ignorer l'effet spécial en cours
function skipSpecial() {
  specialAction = false;
  pendingSpecial = null;
  selectedForSwap = null;
  document.getElementById("skip-special").style.display = "none";
  logAction("⏭ Action spéciale ignorée.");
  endTurnProcedure();
}

// Met fin au tour courant et passe au suivant
function endTurnProcedure() {
  // Pour éviter de changer de tour si un effet spécial est en cours
  if (specialAction) return;
  // Passer au joueur suivant : on incrémente le numéro de joueur dans la salle
  let next = currentPlayerIndex ? (currentPlayerIndex % playerCount) + 1 : 1;
  set(ref(db, `games/${roomId}/currentPlayer`), next);
}

// Réinitialise (reset) la partie – ici simplement en réaffichant l'écran de configuration
function resetGame() {
  // Remise à zéro du state local et dans la DB (pour simplifier, rechargez la page)
  sessionStorage.clear();
  window.location.reload();
}

// ***** Firebase Synchronization et Lobby ***** //

function watchPlayers() {
  const playersRef = ref(db, `games/${roomId}/players`);
  onValue(playersRef, (snapshot) => {
    const data = snapshot.val();
    if (!data) return;
    playersData = data;
    playersByIndex = {};
    playerCount = 0;
    for (let name in data) {
      const idx = data[name].index;
      if (idx) {
        playersByIndex[idx] = name;
        playerCount++;
      }
    }
    // Si ce joueur n'a pas encore son index, l'attribuer
    if (!playerIndex && playersData[username] && playersData[username].index) {
      playerIndex = playersData[username].index;
    }
    // Mettre à jour le lobby
    const lobbyPlayers = document.getElementById("lobby-players");
    if (lobbyPlayers) {
      lobbyPlayers.innerHTML = "<ul>" + Object.keys(data).map(n => `<li>${n}${data[n].index === 1 ? " (hôte)" : ""}</li>`).join("") + "</ul>";
    }
  });
}

function watchGameState() {
  const stateRef = ref(db, `games/${roomId}/state`);
  onValue(stateRef, (snapshot) => {
    const state = snapshot.val();
    if (!state) return;
    if (state === "setup") {
      document.getElementById("lobby").style.display = "none";
      document.getElementById("setup").style.display = "block";
      logAction("🟢 Configuration de la partie en cours...");
    } else if (state === "playing") {
      document.getElementById("lobby").style.display = "none";
      document.getElementById("setup").style.display = "none";
      document.getElementById("game").style.display = "block";
      gameStarted = true;
      currentRound = 1;
      updateScoreboard();
      renderGameArea();
      logAction("🎮 La partie commence !");
    }
  });
}

function watchTurn() {
  const turnRef = ref(db, `games/${roomId}/currentPlayer`);
  onValue(turnRef, (snapshot) => {
    const turn = snapshot.val();
    if (turn === null) return;
    currentPlayerIndex = turn;
    updateTurnUI();
    logAction("🔄 Tour du joueur " + turn);
  });
}

function watchDiscard() {
  const discardRef = ref(db, `games/${roomId}/discard`);
  onValue(discardRef, (snapshot) => {
    currentDiscard = snapshot.val();
    const discardEl = document.getElementById("discard");
    if (discardEl) discardEl.innerText = currentDiscard ?? "Vide";
  });
}

// ***** Action par l'utilisateur ***** //

function loginHandler() {
  const userInput = document.getElementById("username");
  const name = userInput.value.trim();
  if (!name) {
    alert("Veuillez entrer un pseudo.");
    return;
  }
  username = name;
  sessionStorage.setItem("username", username);
  document.getElementById("welcome").style.display = "none";
  document.getElementById("config").style.display = "block";
  document.getElementById("player-name").innerText = username;
  logAction("👋 Bienvenue, " + username + " !");
}

async function createRoom() {
  // Générer un code de salle à 6 caractères
  const code = Math.random().toString(36).substring(2, 8).toUpperCase();
  roomId = code;
  isHost = true;
  username = username || sessionStorage.getItem("username") || "Hôte";
  sessionStorage.setItem("roomId", roomId);
  sessionStorage.setItem("username", username);
  sessionStorage.setItem("isHost", "true");
  // Ajouter l'hôte dans la DB avec index 1 et score 0
  await set(ref(db, `games/${roomId}/players/${username}`), { connected: true, index: 1, score: 0 });
  await set(ref(db, `games/${roomId}/host`), username);
  await set(ref(db, `games/${roomId}/currentPlayer`), 1);
  document.getElementById("config").style.display = "none";
  document.getElementById("lobby").style.display = "block";
  document.getElementById("lobby-room").innerText = roomId;
  logAction("🔧 Partie créée. Code : " + roomId);
  logAction("👤 Joueur ajouté : " + username + " (hôte)");
  watchPlayers();
  watchGameState();
  watchTurn();
  watchDiscard();
}

async function joinRoom() {
  const codeInput = document.getElementById("room-code");
  const code = codeInput.value.trim().toUpperCase();
  if (!code) {
    alert("Entrez un code de salle valide.");
    return;
  }
  roomId = code;
  isHost = false;
  username = username || sessionStorage.getItem("username") || "Joueur";
  sessionStorage.setItem("roomId", roomId);
  sessionStorage.setItem("username", username);
  sessionStorage.setItem("isHost", "false");
  try {
    const snapshot = await get(ref(db, `games/${roomId}/players`));
    if (!snapshot.exists()) {
      alert("Salle introuvable.");
      return;
    }
    const currentPlayers = snapshot.val();
    const count = Object.keys(currentPlayers).length;
    const newIndex = count + 1;
    await set(ref(db, `games/${roomId}/players/${username}`), { connected: true, index: newIndex, score: 0 });
  } catch (err) {
    console.error("Erreur lors du join :", err);
    alert("Impossible de rejoindre la salle.");
    return;
  }
  document.getElementById("config").style.display = "none";
  document.getElementById("lobby").style.display = "block";
  document.getElementById("lobby-room").innerText = roomId;
  logAction("🔗 Rejoint la salle : " + roomId);
  logAction("👤 Joueur ajouté : " + username);
  watchPlayers();
  watchGameState();
  watchTurn();
  watchDiscard();
}

function launchSetup() {
  if (!isHost) return;
  awaitSet(ref(db, `games/${roomId}/state`), "setup");
  // L'UI sera gérée via watchGameState
}

function startGame() {
  if (!isHost) return;
  const configData = { cardCount, startVisibleCount, targetScore };
  set(ref(db, `games/${roomId}/config`), configData);
  // Distribuer les cartes aléatoirement à tous les joueurs
  const deck = ["R", "A", 2,3,4,5,6,7,8,9,10,"V","D"];
  const updates = {};
  for (let name in playersData) {
    const hand = [];
    for (let i = 0; i < cardCount; i++) {
      hand.push(deck[Math.floor(Math.random()*deck.length)]);
    }
    updates[`games/${roomId}/players/${name}/hand`] = hand;
    updates[`games/${roomId}/players/${name}/score`] = playersData[name].score ?? 0;
  }
  updates[`games/${roomId}/discard`] = null;
  updates[`games/${roomId}/state`] = "playing";
  updates[`games/${roomId}/round`] = 1;
  update(ref(db), updates);
  currentRound = 1;
  gameStarted = true;
  document.getElementById("btn-new-round").style.display = "none";
  document.getElementById("btn-reset-game").style.display = "none";
  logAction("🎮 La partie commence !");
}

window.addEventListener("load", () => {
  // Vérifier si une session existe déjà pour reconnecter le joueur
  const savedRoom = sessionStorage.getItem("roomId");
  const savedUser = sessionStorage.getItem("username");
  const savedHost = sessionStorage.getItem("isHost");
  if (savedRoom && savedUser) {
    roomId = savedRoom;
    username = savedUser;
    isHost = (savedHost === "true");
    // Afficher écran lobby et recharger l'état via Firebase
    document.getElementById("welcome").style.display = "none";
    document.getElementById("config").style.display = "none";
    document.getElementById("lobby").style.display = "block";
    document.getElementById("lobby-room").innerText = roomId;
    logAction("🔗 Reconnexion à la salle " + roomId + "...");
    watchPlayers();
    watchGameState();
    watchTurn();
    watchDiscard();
  }
});

// Activation des boutons dès que Firebase est prêt
document.getElementById("btn-create-room").disabled = false;
document.getElementById("btn-join-room").disabled = false;

// Écouteurs d'événements
document.getElementById("btn-login").addEventListener("click", loginHandler);
document.getElementById("btn-create-room").addEventListener("click", createRoom);
document.getElementById("btn-join-room").addEventListener("click", joinRoom);
document.getElementById("btn-start-game").addEventListener("click", startGame);
document.getElementById("btn-draw-card").addEventListener("click", drawCard);
document.getElementById("btn-discard-swap").addEventListener("click", takeDiscard);
document.getElementById("skip-special").addEventListener("click", skipSpecial);
document.getElementById("btn-declare-cactus").addEventListener("click", () => declareCactus("Vous"));
document.getElementById("btn-new-round").addEventListener("click", startNewRound);
document.getElementById("btn-reset-game").addEventListener("click", resetGame);
