// Importation des modules Firebase (SDK modulaire)
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.5.0/firebase-app.js";
import { getDatabase, ref, set, update, onValue, get } from "https://www.gstatic.com/firebasejs/11.5.0/firebase-database.js";

// Configuration de Firebase
const firebaseConfig = {
  apiKey: "AIzaSyBd2O4MWVNlY5MOVffdcvMrkj2lLxJcdv0",
  authDomain: "cactus-game-12ae9.firebaseapp.com",
  projectId: "cactus-game-12ae9",
  storageBucket: "cactus-game-12ae9.appspot.com",
  messagingSenderId: "852427558969",
  appId: "1:852427558969:web:0b292c74c6305dc348fde8",
  databaseURL: "https://cactus-game-12ae9-default-rtdb.firebaseio.com/"
};
// Initialise l'application Firebase et la base de données
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// Variables globales du jeu
let roomId = null;
let username = null;
let isHost = false;
let playerIndex = null;             // Index du joueur (1..N dans la partie)
let playerCount = 0;
let playersData = {};              // Données actuelles des joueurs (noms, mains, scores, etc.)
let playersByIndex = {};           // Association index -> nom du joueur
let currentPlayerIndex = null;     // Index du joueur dont c'est le tour
let cardCount = 4;
let startVisibleCount = 2;
let targetScore = 3;
let currentRound = 0;
let gameStarted = false;
let drawnCard = null;              // Carte actuellement piochée par ce joueur (s'il y en a une)
let currentDiscard = null;         // Carte du dessus de la défausse
// Indicateurs pour les actions spéciales
let specialAction = false;
let pendingSpecial = null;
let selectedForSwap = null;        // Utilisé pour l'effet du Valet : stocke la carte sélectionnée pour l'échange
let cactusDeclared = false;
let cactusPlayerIndex = null;

// Utilitaire : ajoute un message au journal de jeu (log)
function logAction(msg) {
  const logDiv = document.getElementById("log");
  if (logDiv) {
    logDiv.innerHTML += `<p>${msg}</p>`;
  }
  console.log(msg);
}

// Met à jour le tableau des scores (UI) avec les scores actuels et la manche courante
function updateScoreboard() {
  const board = document.getElementById("scoreboard");
  if (!board || !playersData) return;
  // Construit la liste des scores triée par index de joueur
  let scoreboardHTML = "<strong>Scores</strong>";
  for (let i = 1; i <= playerCount; i++) {
    const name = playersByIndex[i];
    if (!name) continue;
    const score = playersData[name].score ?? 0;
    scoreboardHTML += `<br>${name} : ${score}`;
  }
  scoreboardHTML += `<div class="round-info">Manche : ${currentRound}</div>`;
  board.innerHTML = scoreboardHTML;
}

// Affiche toutes les cartes des joueurs dans la zone de jeu
function renderGameArea() {
  const area = document.getElementById("game-area");
  if (!area || !playersData) return;
  area.innerHTML = "";  // nettoyer l'aire de jeu
  for (let i = 1; i <= playerCount; i++) {
    const name = playersByIndex[i];
    if (!name) continue;
    const hand = playersData[name].hand || [];
    // Crée un conteneur pour la main de ce joueur
    const playerDiv = document.createElement("div");
    playerDiv.className = "player-area";
    // Étiquette du joueur : affiche le pseudo (marque "(Vous)" pour le joueur local)
    const label = document.createElement("h3");
    label.textContent = (name === username) ? `${name} (Vous)` : name;
    playerDiv.appendChild(label);
    // Cartes du joueur (affichées face cachée)
    hand.forEach((cardValue, idx) => {
      const wrapper = document.createElement("div");
      wrapper.className = "card-wrapper";
      const cardEl = document.createElement("div");
      cardEl.className = "card";
      // Affiche une carte face cachée (point d'interrogation) pour chaque carte
      cardEl.innerText = "?";
      // Attributs data pour identifier la carte cliquée
      cardEl.dataset.player = String(playersData[name].index);
      cardEl.dataset.index = String(idx);
      // Attache un gestionnaire de clic pour les actions sur la carte (échange, révélation, etc.)
      cardEl.addEventListener("click", onCardClick);
      wrapper.appendChild(cardEl);
      playerDiv.appendChild(wrapper);
    });
    area.appendChild(playerDiv);
  }
}

// Gestionnaire de clic sur une carte (celle du joueur ou d'un adversaire)
function onCardClick(event) {
  const cardEl = event.currentTarget;
  const player = parseInt(cardEl.dataset.player);
  const index = parseInt(cardEl.dataset.index);
  if (isNaN(player) || isNaN(index) || !playersData) return;
  const name = playersByIndex[player];
  const handArray = playersData[name]?.hand;
  if (!handArray) return;

  // Si une action spéciale est en cours, gérer les cas spéciaux
  if (specialAction && pendingSpecial === 8 && player === currentPlayerIndex) {
    // Effet 8 : révéler l'une de vos propres cartes pendant 5 secondes
    if (selectedForSwap !== null) return;
    selectedForSwap = true;
    const value = handArray[index];
    cardEl.innerText = value;
    logAction("👁 Carte révélée : " + value);
    setTimeout(() => {
      cardEl.innerText = "?";
      selectedForSwap = null;
      // Terminer l'effet spécial (passe le tour)
      skipSpecial();
    }, 5000);
    return;
  }
  if (specialAction && pendingSpecial === 10 && player !== currentPlayerIndex) {
    // Effet 10 : révéler une carte d'un adversaire pendant 5 secondes
    if (selectedForSwap !== null) return;
    selectedForSwap = true;
    const value = handArray[index];
    cardEl.innerText = value;
    logAction("🔍 Carte adverse révélée : " + value);
    setTimeout(() => {
      cardEl.innerText = "?";
      selectedForSwap = null;
      skipSpecial();
    }, 5000);
    return;
  }
  if (specialAction && pendingSpecial === "V") {
    // Effet du Valet : échanger une de vos cartes avec celle d'un adversaire
    if (!selectedForSwap && player === currentPlayerIndex) {
      // Premier clic : sélectionner l'une de vos cartes à échanger
      selectedForSwap = { player, index };
      logAction("👉 Sélectionnez une carte adverse à échanger avec la vôtre.");
      return;
    }
    if (selectedForSwap && player !== currentPlayerIndex) {
      // Deuxième clic : sur une carte d'un adversaire, effectuer l'échange
      const myIndex = selectedForSwap.index;
      const opponentName = playersByIndex[player];
      const myName = playersByIndex[selectedForSwap.player];
      if (!playersData[myName] || !playersData[opponentName]) return;
      const myHand = [...playersData[myName].hand];
      const oppHand = [...playersData[opponentName].hand];
      const temp = myHand[myIndex];
      myHand[myIndex] = oppHand[index];
      oppHand[index] = temp;
      // Met à jour les deux mains dans la base de données
      const updates = {};
      updates[`games/${roomId}/players/${myName}/hand`] = myHand;
      updates[`games/${roomId}/players/${opponentName}/hand`] = oppHand;
      update(ref(db), updates);
      selectedForSwap = null;
      logAction("🔄 Cartes échangées entre " + myName + " et " + opponentName);
      // Fin de l'effet spécial et du tour
      skipSpecial();
      return;
    }
  }

  // Si aucune action spéciale n'est en cours, gérer un clic normal (pour échanger la carte piochée)
  if (player !== currentPlayerIndex || drawnCard === null) {
    // Pas le tour de ce joueur ou pas de carte piochée à échanger
    return;
  }
  // Le joueur actuel a cliqué sur l'une de ses cartes pour l'échanger avec la carte piochée
  const currentName = playersByIndex[currentPlayerIndex];
  const handArr = playersData[currentName]?.hand;
  if (!handArr) return;
  const replaced = handArr[index];
  // Effectuer l'échange : placer la carte piochée dans la main et envoyer la carte remplacée à la défausse
  handArr[index] = drawnCard;
  const oldCard = replaced;
  const newCard = drawnCard;
  drawnCard = null;
  // Met à jour la main du joueur et la pile de défausse dans la base
  set(ref(db, `games/${roomId}/players/${currentName}/hand`), handArr);
  set(ref(db, `games/${roomId}/discard`), oldCard);
  // Masquer l'affichage de la carte piochée et journaliser l'échange
  const drawnCardElem = document.getElementById("drawn-card");
  if (drawnCardElem) drawnCardElem.style.display = "none";
  logAction(`🔄 Carte échangée : ${oldCard} ↔ ${newCard}`);
  // Vérifier si la carte défaussée déclenche un effet spécial
  handleSpecialCard(oldCard);
}

// Vérifie si une carte défaussée déclenche un effet spécial. Renvoie true si une action spéciale est lancée.
function handleSpecialCard(card) {
  // Valeurs déclenchant un effet : "8", "10", "V" (Valet)
  // (Roi = 0 pts, As = 1 pt, 2 = -2 pts, Dame = 10 pts sans effet)
  specialAction = false;
  pendingSpecial = null;
  if (card === 8) {
    specialAction = true;
    pendingSpecial = 8;
    // Permettre au joueur de regarder une de ses cartes
    document.getElementById("skip-special").style.display = "inline-block";
    logAction("👁 Effet spécial : regardez une de vos cartes.");
    return true;
  }
  if (card === 10) {
    specialAction = true;
    pendingSpecial = 10;
    // Permettre de regarder une carte d'un adversaire
    document.getElementById("skip-special").style.display = "inline-block";
    logAction("🔍 Effet spécial : regardez une carte d'un adversaire.");
    return true;
  }
  if (card === "V") {  // Valet
    specialAction = true;
    pendingSpecial = "V";
    document.getElementById("skip-special").style.display = "inline-block";
    logAction("🔄 Effet spécial : échangez une de vos cartes avec un adversaire.");
    return true;
  }
  return false;
}

// Termine le tour du joueur actuel et passe au joueur suivant (sauf si la déclaration de Cactus met fin à la manche)
function endTurnProcedure() {
  if (specialAction) {
    // Si une action spéciale est en cours, ne pas terminer le tour tant que ce n'est pas résolu
    return;
  }
  if (cactusDeclared && currentPlayerIndex !== cactusPlayerIndex) {
    // Si Cactus a été déclaré et qu'on vient de donner la main au joueur suivant, on termine la manche ici
    // (Le décompte final sera déclenché par l'hôte lors du changement de tour)
    return;
  }
  // Passe le tour au joueur suivant
  let nextIndex = currentPlayerIndex ? (currentPlayerIndex % playerCount) + 1 : 1;
  set(ref(db, `games/${roomId}/currentPlayer`), nextIndex);
}

// Action "Passer l'action spéciale" : annule ou termine tout effet spécial en cours et termine le tour
function skipSpecial() {
  specialAction = false;
  pendingSpecial = null;
  selectedForSwap = null;
  // Masquer le bouton "Passer l'action spéciale" s'il est visible
  const skipBtn = document.getElementById("skip-special");
  if (skipBtn) skipBtn.style.display = "none";
  logAction("⏭ Action spéciale terminée");
  endTurnProcedure();
}

// Gère la pioche d'une nouvelle carte depuis le talon
function drawCard() {
  if (currentPlayerIndex !== playerIndex) {
    return logAction("⛔ Ce n'est pas votre tour de jouer !");
  }
  if (drawnCard !== null) {
    return logAction("⏳ Vous avez déjà une carte piochée en attente.");
  }
  // Pioche une carte aléatoire (simulation d'un paquet infini)
  const pool = ["R","A",2,3,4,5,6,7,8,9,10,"V","D"];
  drawnCard = pool[Math.floor(Math.random() * pool.length)];
  logAction("🃏 Carte piochée : " + drawnCard);
  // Affiche la carte piochée dans l'interface pour le joueur qui pioche
  const newCardSpan = document.getElementById("new-card");
  const drawnCardP = document.getElementById("drawn-card");
  if (newCardSpan && drawnCardP) {
    newCardSpan.innerText = drawnCard;
    drawnCardP.style.display = "block";  // rendre visible l'indication de carte piochée
  }
}

// Gère la prise de la carte du dessus de la défausse
function takeDiscard() {
  if (currentPlayerIndex !== playerIndex) {
    return logAction("⛔ Ce n'est pas votre tour de jouer !");
  }
  if (currentDiscard === null) {
    return logAction("❌ Aucune carte dans la défausse à prendre.");
  }
  if (drawnCard !== null) {
    return logAction("⏳ Vous devez d'abord jouer/défausser la carte que vous avez piochée.");
  }
  // Prend la carte de la défausse comme carte piochée
  drawnCard = currentDiscard;
  // Retire la carte de la pile de défausse dans la base (la défausse devient vide)
  set(ref(db, `games/${roomId}/discard`), null);
  logAction("🔁 Carte récupérée de la défausse : " + drawnCard);
  // Affiche cette carte au joueur comme carte piochée
  const newCardSpan = document.getElementById("new-card");
  const drawnCardP = document.getElementById("drawn-card");
  if (newCardSpan && drawnCardP) {
    newCardSpan.innerText = drawnCard;
    drawnCardP.style.display = "block";
  }
}

// Gère la défausse de la carte actuellement piochée (si le joueur décide de ne pas l'échanger)
function discardDrawnCard() {
  if (drawnCard === null) return;
  // Place la carte piochée dans la pile de défausse
  const card = drawnCard;
  drawnCard = null;
  set(ref(db, `games/${roomId}/discard`), card);
  logAction("🗑 Carte défaussée : " + card);
  // Vérifie si cette carte défaussée déclenche un effet spécial
  const hadSpecial = handleSpecialCard(card);
  // Cache l'indicateur de carte piochée
  const drawnCardP = document.getElementById("drawn-card");
  if (drawnCardP) drawnCardP.style.display = "none";
  // Si aucun effet spécial n'est déclenché, terminer le tour immédiatement
  if (!hadSpecial) {
    endTurnProcedure();
  }
}

// Déclare "Cactus" (fin de manche)
function declareCactus() {
  if (cactusDeclared) return;  // déjà déclaré auparavant
  cactusDeclared = true;
  cactusPlayerIndex = currentPlayerIndex;
  logAction("🌵 Joueur " + currentPlayerIndex + " dit Cactus !");
  // Terminer le tour immédiatement après la déclaration
  endTurnProcedure();
}

// Dévoile les scores finaux et détermine le vainqueur de la manche (exécuté par l'hôte uniquement)
function revealFinalScores() {
  // Calcule la somme des valeurs de la main de chaque joueur
  const sumHand = (cards) => cards.reduce((total, c) => total + getCardValue(c), 0);
  let totals = {};
  for (let name in playersData) {
    const hand = playersData[name].hand || [];
    totals[name] = sumHand(hand);
    logAction("🧮 " + name + " : " + totals[name]);
    // Vérifie le "Cactus Royal" (si toutes les cartes sont des Rois)
    if (hand.length > 0 && hand.every(c => c === "R")) {
      logAction("👑 " + name + " a un Cactus Royal !");
    }
  }
  // Détermine le gagnant de la manche (si un joueur a un total <= 5, le plus bas total gagne; égalité en cas d'ex æquo)
  let winnerName = null;
  let lowestScore = Infinity;
  let success = false;
  for (let name in totals) {
    if (totals[name] <= 5) {
      success = true;
      if (totals[name] < lowestScore) {
        lowestScore = totals[name];
        winnerName = name;
      } else if (totals[name] === lowestScore) {
        winnerName = null;  // égalité pour le plus bas score
      }
    }
  }
  if (!success) {
    logAction("❌ Aucun joueur n’a réussi le Cactus.");
  } else if (!winnerName) {
    logAction("🤝 Égalité ! Pas de gagnant pour cette manche.");
  } else {
    logAction("🏆 " + winnerName + " remporte la manche !");
    // Incrémente le score du gagnant
    const newScore = (playersData[winnerName].score || 0) + 1;
    set(ref(db, `games/${roomId}/players/${winnerName}/score`), newScore);
    // Vérifie si la partie est gagnée (score cible atteint)
    if (newScore >= targetScore) {
      logAction("🎉 " + winnerName + " remporte la partie !");
      // Affiche le bouton de reset de partie pour tous les joueurs
      document.getElementById("btn-reset-game").style.display = "inline-block";
      document.getElementById("btn-new-round").style.display = "none";
    }
  }
  // Fin de manche – si la partie n'est pas terminée, permettre de démarrer une nouvelle manche
  if (isHost) {
    cactusDeclared = false;
    cactusPlayerIndex = null;
    const newRoundBtn = document.getElementById("btn-new-round");
    if (newRoundBtn) {
      newRoundBtn.style.display = "inline-block";
    }
  }
}

// Fonction utilitaire pour obtenir la valeur numérique d'une carte (pour le calcul des scores)
function getCardValue(card) {
  if (card === "R") return 0;
  if (card === "A") return 1;
  if (card === 2) return -2;
  if (card === "V" || card === "D" || card === 10) return 10;
  if (typeof card === "number") return card;
  return 10;
}

// Réinitialise la partie et revient au lobby (réinitialisation de l'UI localement)
function resetGame() {
  // (Dans une implémentation complète, on supprimerait l'état de la partie dans la base de données)
  document.getElementById("config").style.display = "block";
  document.getElementById("game").style.display = "none";
  document.getElementById("btn-reset-game").style.display = "none";
  document.getElementById("log").innerHTML = "";
  // Réinitialise les variables locales de jeu
  playersData = {};
  playersByIndex = {};
  playerIndex = null;
  playerCount = 0;
  currentPlayerIndex = null;
  currentRound = 0;
  gameStarted = false;
  drawnCard = null;
  currentDiscard = null;
  specialAction = false;
  pendingSpecial = null;
  selectedForSwap = null;
  cactusDeclared = false;
  cactusPlayerIndex = null;
  logAction("🔁 Partie réinitialisée.");
}

// ***** Synchronisation en temps réel avec Firebase Realtime Database *****

// Surveille les changements du joueur dont c'est le tour
function watchTurn() {
  const turnRef = ref(db, `games/${roomId}/currentPlayer`);
  onValue(turnRef, (snapshot) => {
    const turn = snapshot.val();
    if (turn === null) return;
    currentPlayerIndex = turn;
    // Met à jour l'indicateur de tour
    const turnInfo = document.getElementById("turn-info");
    if (turnInfo) {
      const name = playersByIndex[turn] || `Joueur ${turn}`;
      turnInfo.innerText = "Tour de " + name;
    }
    // Active ou désactive les boutons d'actions selon le joueur courant
    const isMyTurn = (turn === playerIndex);
    document.getElementById("btn-draw-card").disabled = !isMyTurn;
    document.getElementById("btn-discard-swap").disabled = !isMyTurn;
    document.getElementById("btn-declare-cactus").disabled = !isMyTurn;
    // Journalise le changement de tour
    logAction("🔄 Tour du joueur " + turn);
    // Si Cactus a été déclaré et qu'on vient de passer au joueur suivant, l'hôte déclenche le décompte final
    if (cactusDeclared && turn !== cactusPlayerIndex && isHost) {
      revealFinalScores();
    }
  });
}

// Surveille les changements dans la liste des joueurs (connexion, mains, scores)
function watchPlayers() {
  const playersRef = ref(db, `games/${roomId}/players`);
  onValue(playersRef, (snapshot) => {
    const data = snapshot.val();
    if (!data) return;
    playersData = data;
    // Reconstruit la table d'index des joueurs et compte le nombre de joueurs
    playersByIndex = {};
    playerCount = 0;
    for (let name in data) {
      const pIndex = data[name].index;
      if (pIndex) {
        playersByIndex[pIndex] = name;
        playerCount++;
      }
    }
    // Définit l'index de ce joueur s'il n'est pas encore connu
    if (!playerIndex && username && data[username] && data[username].index) {
      playerIndex = data[username].index;
    }
    // Met à jour l'interface du lobby ou du jeu en fonction de l'état
    if (!gameStarted) {
      // Lobby : met à jour la liste des joueurs présents
      const listElem = document.getElementById("lobby-players");
      if (listElem) {
        const names = Object.keys(data);
        if (names.length > 0) {
          listElem.innerHTML = "<ul>" + names.map(n =>
            `<li>${n}${data[n].index === 1 ? " (hôte)" : ""}</li>`).join("") + "</ul>";
        }
      }
      // Affiche le bouton "Lancer la partie" à l'hôte si au moins 2 joueurs sont connectés
      const startBtn = document.getElementById("start-game");
      if (startBtn) {
        startBtn.style.display = (isHost && Object.keys(data).length >= 2) ? "inline-block" : "none";
      }
    } else {
      // En jeu : met à jour le tableau des scores et réaffiche les cartes
      updateScoreboard();
      renderGameArea();
    }
  });
}

// Surveille l'état de la partie (pour passer du lobby à la config, puis au jeu)
function watchGameState() {
  const stateRef = ref(db, `games/${roomId}/state`);
  onValue(stateRef, (snapshot) => {
    const state = snapshot.val();
    if (!state) return;
    if (state === "setup") {
      // Passe du lobby à l'écran de configuration pour tous les joueurs
      document.getElementById("lobby").style.display = "none";
      document.getElementById("setup").style.display = "block";
      logAction("🟢 Configuration de la partie en cours...");
    } else if (state === "playing") {
      // Démarre la partie pour tous les joueurs
      document.getElementById("lobby").style.display = "none";
      document.getElementById("setup").style.display = "none";
      document.getElementById("game").style.display = "block";
      gameStarted = true;
      // Initialise les surveillances de tour, de défausse et de manche
      watchTurn();
      watchDiscard();
      watchRound();
      // L'hôte a déjà distribué les cartes et défini le joueur initial. Pour un client, les données sont déjà disponibles via watchPlayers.
      // Affiche l'état de jeu initial
      currentRound = 1;
      updateScoreboard();
      renderGameArea();
      // Si ce joueur n'est pas l'hôte, masque les boutons de nouvelle manche et de réinitialisation
      if (!isHost) {
        document.getElementById("btn-new-round").style.display = "none";
        document.getElementById("btn-reset-game").style.display = "none";
      }
      // Permet à chaque joueur de regarder ses cartes initiales visibles
      if (playersData[username] && playersData[username].hand) {
        startInitialPeek();
      }
      logAction("🎮 La partie commence !");
    }
  });
}

// Surveille la carte du dessus de la défausse
function watchDiscard() {
  const discardRef = ref(db, `games/${roomId}/discard`);
  onValue(discardRef, (snapshot) => {
    currentDiscard = snapshot.val();
    const discardText = document.getElementById("discard");
    if (discardText) {
      discardText.innerText = currentDiscard ?? "Vide";
    }
  });
}

// Surveille le numéro de la manche en cours
function watchRound() {
  const roundRef = ref(db, `games/${roomId}/round`);
  onValue(roundRef, (snapshot) => {
    const roundNum = snapshot.val();
    if (roundNum !== null) {
      currentRound = roundNum;
      updateScoreboard();
    }
  });
}

// Permet au joueur de révéler ses cartes initiales visibles (début de manche)
function startInitialPeek() {
  // Met en surbrillance jusqu'à startVisibleCount cartes pour que le joueur puisse les voir temporairement
  const myCards = document.querySelectorAll(`#game-area .card[data-player="${playerIndex}"]`);
  let revealed = 0;
  const toReveal = Math.min(startVisibleCount, myCards.length);
  if (toReveal <= 0) return;
  logAction(`👆 Sélectionnez ${toReveal} carte(s) à regarder (cartes de départ).`);
  myCards.forEach(cardEl => {
    // Ne permet le clic que sur ses propres cartes pour le peek initial
    if (parseInt(cardEl.dataset.player) !== playerIndex) return;
    cardEl.classList.add("selectable-start");
    cardEl.addEventListener("click", function handleInitialClick() {
      if (revealed >= toReveal) {
        cardEl.classList.remove("selectable-start");
        cardEl.removeEventListener("click", handleInitialClick);
        return;
      }
      // Révèle la valeur de la carte
      const idx = parseInt(cardEl.dataset.index);
      const myHand = playersData[username]?.hand;
      if (!myHand) return;
      cardEl.innerText = myHand[idx];
      cardEl.classList.add("highlight");
      revealed++;
      if (revealed === toReveal) {
        logAction(`👀 Vous avez regardé vos ${toReveal} carte(s) de départ.`);
        // Cache à nouveau ces cartes après 5 secondes
        setTimeout(() => {
          myCards.forEach(el => {
            el.innerText = "?";
            el.classList.remove("highlight");
            el.classList.remove("selectable-start");
            el.removeEventListener("click", handleInitialClick);
          });
          logAction("🕑 Vos cartes sont à nouveau cachées.");
        }, 5000);
      }
    });
  });
}

// ***** Gestionnaires d'interactions utilisateur (Login, Créer/Rejoindre, Démarrer, etc.) *****

// Gère la connexion de l'utilisateur (saisie du pseudo)
function login() {
  const userInput = document.getElementById("username");
  const name = userInput.value.trim();
  if (!name) {
    alert("Veuillez entrer un pseudo.");
    return;
  }
  username = name;
  sessionStorage.setItem("username", username);
  // Passe à l'écran de sélection de partie
  document.getElementById("welcome").style.display = "none";
  document.getElementById("config").style.display = "block";
  document.getElementById("player-name")?.innerText = username;
  logAction("👋 Bienvenue, " + username + " !");
}

// Crée une nouvelle partie
async function createRoom() {
  // Génère un code de partie de 6 caractères aléatoires
  const code = Math.random().toString(36).substring(2, 8).toUpperCase();
  roomId = code;
  isHost = true;
  username = username || sessionStorage.getItem("username") || "Hôte";
  // Sauvegarde les infos de session
  sessionStorage.setItem("roomId", roomId);
  sessionStorage.setItem("username", username);
  sessionStorage.setItem("isHost", "true");
  // Initialise la salle dans la base : ajoute le joueur hôte (index 1, score 0)
  await set(ref(db, `games/${roomId}/players/${username}`), { connected: true, index: 1, score: 0 });
  await set(ref(db, `games/${roomId}/host`), username);
  // Définit le tour initial au joueur 1 (hôte) dans la base
  await set(ref(db, `games/${roomId}/currentPlayer`), 1);
  // Affiche l'interface du lobby
  document.getElementById("config").style.display = "none";
  document.getElementById("lobby").style.display = "block";
  document.getElementById("lobby-room").innerText = roomId;
  logAction("🔧 Partie créée. Code : " + roomId);
  logAction("👤 Joueur ajouté : " + username + " (hôte)");
  // Commence à surveiller les joueurs et l'état de la partie
  watchPlayers();
  watchGameState();
}

// Rejoint une partie existante
async function joinRoom() {
  const codeInput = document.getElementById("room-code");
  const code = codeInput.value.trim().toUpperCase();
  if (!code) {
    return alert("Entrez un code de partie valide.");
  }
  roomId = code;
  isHost = false;
  username = username || sessionStorage.getItem("username") || "Joueur";
  sessionStorage.setItem("roomId", roomId);
  sessionStorage.setItem("username", username);
  sessionStorage.setItem("isHost", "false");
  // Détermine le prochain index de joueur en comptant les joueurs existants dans la base
  try {
    const snapshot = await get(ref(db, `games/${roomId}/players`));
    if (!snapshot.exists()) {
      return alert("Code de partie introuvable.");
    }
    const currentPlayers = snapshot.val();
    const count = Object.keys(currentPlayers).length;
    if (count >= 8) {
      return alert("Cette partie est complète (8 joueurs maximum).");
    }
    const newIndex = count + 1;
    // Ajoute ce joueur dans la salle
    await set(ref(db, `games/${roomId}/players/${username}`), { connected: true, index: newIndex, score: 0 });
  } catch (err) {
    console.error("Join room error:", err);
    return alert("Impossible de rejoindre la partie. Vérifiez le code.");
  }
  // Affiche l'interface du lobby
  document.getElementById("config").style.display = "none";
  document.getElementById("lobby").style.display = "block";
  document.getElementById("lobby-room").innerText = roomId;
  logAction("🔗 Rejoint la partie : " + roomId);
  logAction("👤 Joueur ajouté : " + username);
  // Commence à surveiller les joueurs et l'état de la partie
  watchPlayers();
  watchGameState();
}

// Lance l'écran de configuration de la partie (clic "Lancer la partie" par l'hôte dans le lobby)
function launchSetup() {
  if (!isHost) return;
  set(ref(db, `games/${roomId}/state`), "setup");
  // (L'affichage de l'écran de config est géré via watchGameState sur tous les clients)
}

// Enregistre la configuration de la partie (hôte uniquement)
function saveGameConfig() {
  if (!isHost) return;
  // Lit les valeurs des champs de configuration
  cardCount = parseInt(document.getElementById("card-count").value) || 4;
  startVisibleCount = parseInt(document.getElementById("visible-count").value) || 2;
  targetScore = parseInt(document.getElementById("target-score").value) || 3;
  logAction(`💾 Configuration : ${cardCount} cartes, ${startVisibleCount} visibles, objectif ${targetScore} manche(s) gagnante(s).`);
  // (La configuration sera enregistrée dans la base lors du démarrage de la partie)
}

// Démarre la partie (clic "Lancer la partie" par l'hôte sur l'écran de config)
function startGame() {
  if (!isHost) return;
  // Enregistre la configuration de la partie dans la base (optionnel)
  const configData = { cardCount, startVisibleCount, targetScore };
  set(ref(db, `games/${roomId}/config`), configData);
  // Distribue des mains aléatoires à chaque joueur
  const deckValues = ["R","A",2,3,4,5,6,7,8,9,10,"V","D"];
  const updates = {};
  for (let name in playersData) {
    const hand = [];
    for (let i = 0; i < cardCount; i++) {
      hand.push(deckValues[Math.floor(Math.random() * deckValues.length)]);
    }
    updates[`games/${roomId}/players/${name}/hand`] = hand;
    // S'assure que chaque joueur a un champ score (le laisse inchangé ou 0 par défaut)
    updates[`games/${roomId}/players/${name}/score`] = playersData[name].score ?? 0;
  }
  // Initialise l'état de jeu : vide la défausse, manche 1, et démarre le jeu
  updates[`games/${roomId}/discard`] = null;
  updates[`games/${roomId}/round`] = 1;
  updates[`games/${roomId}/state`] = "playing";
  update(ref(db), updates);
  currentRound = 1;
  // Configuration UI spécifique à l'hôte
  gameStarted = true;
  document.getElementById("btn-new-round").style.display = "none";
  document.getElementById("btn-reset-game").style.display = "none";
  logAction("🃏 Cartes distribuées. La partie va commencer !");
}

// Démarre une nouvelle manche (clic "Nouvelle manche" par l'hôte)
function startNewRound() {
  if (!isHost) return;
  // Incrémente le numéro de manche
  currentRound += 1;
  // Réinitialise les indicateurs spécifiques à la manche
  cactusDeclared = false;
  cactusPlayerIndex = null;
  specialAction = false;
  pendingSpecial = null;
  selectedForSwap = null;
  drawnCard = null;
  // Distribue de nouvelles mains à chaque joueur
  const deckValues = ["R","A",2,3,4,5,6,7,8,9,10,"V","D"];
  const updates = {};
  for (let name in playersData) {
    const newHand = [];
    for (let i = 0; i < cardCount; i++) {
      newHand.push(deckValues[Math.floor(Math.random() * deckValues.length)]);
    }
    updates[`games/${roomId}/players/${name}/hand`] = newHand;
  }
  updates[`games/${roomId}/discard`] = null;
  updates[`games/${roomId}/round`] = currentRound;
  // Remet le tour au joueur 1 (l'hôte commence chaque nouvelle manche)
  updates[`games/${roomId}/currentPlayer`] = 1;
  update(ref(db), updates);
  // Cache le bouton de nouvelle manche jusqu'à la fin de cette manche
  document.getElementById("btn-new-round").style.display = "none";
  logAction("🔁 Nouvelle manche commencée (Manche " + currentRound + ").");
}

// Ajout des écouteurs d'événements sur les éléments de l'interface
document.getElementById("btn-login").addEventListener("click", login);
document.getElementById("btn-create-room").addEventListener("click", createRoom);
document.getElementById("btn-join-room").addEventListener("click", joinRoom);
document.getElementById("start-game").addEventListener("click", launchSetup);
document.getElementById("btn-save-config").addEventListener("click", saveGameConfig);
document.getElementById("btn-start-game").addEventListener("click", startGame);
document.getElementById("btn-draw-card").addEventListener("click", drawCard);
document.getElementById("btn-discard-swap").addEventListener("click", takeDiscard);
document.getElementById("drawn-card").addEventListener("click", discardDrawnCard);
document.getElementById("skip-special").addEventListener("click", skipSpecial);
document.getElementById("btn-declare-cactus").addEventListener("click", declareCactus);
document.getElementById("btn-new-round").addEventListener("click", startNewRound);
document.getElementById("btn-reset-game").addEventListener("click", resetGame);

// Au chargement de la page, si l'utilisateur a déjà une session en cours, le reconnecter automatiquement
window.addEventListener("load", () => {
  const savedRoom = sessionStorage.getItem("roomId");
  const savedName = sessionStorage.getItem("username");
  const savedHost = sessionStorage.getItem("isHost");
  if (savedRoom && savedName) {
    roomId = savedRoom;
    username = savedName;
    isHost = (savedHost === "true");
    // Masquer les écrans d'accueil et de configuration, afficher l'écran approprié
    document.getElementById("welcome").style.display = "none";
    document.getElementById("config").style.display = "none";
    document.getElementById("lobby").style.display = "block";
    document.getElementById("lobby-room").innerText = roomId;
    logAction("🔗 Reconnexion à la partie " + roomId + " en cours...");
    // Reprendre la surveillance des joueurs et de l'état (les callbacks ajusteront l'UI automatiquement)
    watchPlayers();
    watchGameState();
  }
});

// Active les boutons Créer/Rejoindre une fois Firebase initialisé
document.getElementById("btn-create-room").disabled = false;
document.getElementById("btn-join-room").disabled = false;
