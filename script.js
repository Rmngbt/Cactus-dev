// Importation des modules Firebase (SDK modulaire)
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.5.0/firebase-app.js";
import { getDatabase, ref, set, update, onValue, get } from "https://www.gstatic.com/firebasejs/11.5.0/firebase-database.js";

// Configuration de Firebase
const firebaseConfig = {
  apiKey: "AIzaSy...LxJcdv0",  // (clés tronquées pour concision)
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
let playerIndex = null;           // Index du joueur (1..N dans la partie)
let playerCount = 0;
let playersData = {};            // Données actuelles des joueurs (noms, mains, scores, etc.)
let playersByIndex = {};         // Association index -> nom du joueur
let currentPlayerIndex = null;   // Index du joueur dont c'est le tour
let cardCount = 4;
let startVisibleCount = 2;
let targetScore = 3;
let currentRound = 0;
let gameStarted = false;
let drawnCard = null;            // Carte actuellement piochée par ce joueur (s'il y en a une)
let currentDiscard = null;       // Carte du dessus de la défausse
// Indicateurs pour les actions spéciales
let specialAction = false;
let pendingSpecial = null;
let selectedForSwap = null;      // Utilisé pour l'effet du Valet : stocke la carte sélectionnée pour l'échange
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
  area.innerHTML = "";
  for (let i = 1; i <= playerCount; i++) {
    const name = playersByIndex[i];
    if (!name) continue;
    const hand = playersData[name].hand || [];
    // Crée un conteneur pour la main de ce joueur
    const playerDiv = document.createElement("div");
    playerDiv.className = "player-area";
    // Étiquette du joueur : pseudo (marque "(Vous)" pour le joueur local)
    const label = document.createElement("h3");
    label.textContent = (name === username) ? `${name} (Vous)` : name;
    playerDiv.appendChild(label);
    // Cartes du joueur (affichées face cachée par défaut)
    hand.forEach((cardValue, idx) => {
      const wrapper = document.createElement("div");
      wrapper.className = "card-wrapper";
      const cardEl = document.createElement("div");
      cardEl.className = "card";
      cardEl.innerText = "?";
      // Attributs data pour identifier la carte cliquée
      cardEl.dataset.player = String(playersData[name].index);
      cardEl.dataset.index = String(idx);
      // Gestionnaire de clic sur la carte (échange, révélation, etc.)
      cardEl.addEventListener("click", onCardClick);
      // Ajoute un bouton de défausse rapide au-dessus des cartes du joueur local
      if (name === username) {
        const btn = document.createElement("button");
        btn.innerText = "🗑";
        btn.className = "discard-btn";
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          quickDiscard(idx);
        });
        wrapper.appendChild(btn);
      }
      wrapper.appendChild(cardEl);
      playerDiv.appendChild(wrapper);
    });
    area.appendChild(playerDiv);
  }
}

// Gestionnaire de clic sur une carte (dans sa main ou celle d'un adversaire)
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
    // Effet Valet : échanger une de vos cartes avec celle d'un adversaire
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
      const myHand = playersData[myName]?.hand;
      const oppHand = playersData[opponentName]?.hand;
      if (!myHand || !oppHand) {
        selectedForSwap = null;
        return;
      }
      // Échange les cartes entre les deux joueurs
      const temp = myHand[myIndex];
      const oppCard = oppHand[index];
      myHand[myIndex] = oppCard;
      oppHand[index] = temp;
      // Met à jour les mains dans la base de données
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
  // Aucune action spéciale en cours : gérer le clic normal (échange de la carte piochée)
  if (player !== currentPlayerIndex || drawnCard === null) {
    // Pas le tour de ce joueur ou pas de carte piochée à échanger
    return;
  }
  // Le joueur actuel clique sur l'une de ses cartes pour l'échanger avec la carte piochée
  const currentName = playersByIndex[currentPlayerIndex];
  const handArr = playersData[currentName]?.hand;
  if (!handArr) return;
  const replaced = handArr[index];
  // Effectuer l'échange : place la carte piochée dans la main et envoie la carte remplacée à la défausse
  handArr[index] = drawnCard;
  const oldCard = replaced;
  const newCard = drawnCard;
  drawnCard = null;
  set(ref(db, `games/${roomId}/players/${currentName}/hand`), handArr);
  set(ref(db, `games/${roomId}/discard`), oldCard);
  // Masquer l'affichage de la carte piochée et journaliser l'échange
  const drawnCardElem = document.getElementById("drawn-card");
  if (drawnCardElem) drawnCardElem.style.display = "none";
  logAction(`🔄 Carte échangée : ${oldCard} ↔ ${newCard}`);
  // Vérifier si la carte défaussée déclenche un effet spécial
  const hadSpecial = handleSpecialCard(oldCard);
  // Supprimer le bouton "Défausser la carte" s'il était affiché
  const discardBtn = document.getElementById("btn-discard-drawn");
  if (discardBtn) discardBtn.remove();
  // Si aucun effet spécial, terminer le tour du joueur
  if (!hadSpecial) {
    endTurnProcedure();
  }
}

// Gère la défausse rapide d'une carte de la main (si identique à la défausse)
function quickDiscard(index) {
  // Ne pas permettre si une carte piochée est en attente de jeu
  if (drawnCard !== null) {
    return logAction("⏳ Vous devez d'abord jouer/défausser la carte que vous avez piochée.");
  }
  const currentName = playersByIndex[playerIndex];
  if (!currentName || !playersData[currentName]) return;
  const handArr = playersData[currentName].hand;
  if (!handArr) return;
  const card = handArr[index];
  const topDiscard = currentDiscard;
  if (currentDiscard === null) {
    return logAction("❌ Aucune carte dans la défausse pour défausse rapide.");
  }
  // Tentative de défausse rapide
  if (String(card) === String(topDiscard)) {
    // Retire la carte de la main et l'ajoute à la défausse
    handArr.splice(index, 1);
    set(ref(db, `games/${roomId}/players/${currentName}/hand`), handArr);
    set(ref(db, `games/${roomId}/discard`), card);
    logAction(`⚡ Défausse rapide réussie : votre carte ${card} a été défaussée.`);
    // Vérifie si cette carte défaussée déclenche un effet spécial
    const hadSpecial = handleSpecialCard(card);
    // La défausse rapide n'achève pas directement le tour (le joueur peut continuer son tour normalement)
  } else {
    // Échec de la défausse rapide : la carte reste et on ajoute une carte de pénalité
    const pool = ["R","A",2,3,4,5,6,7,8,9,10,"V","D"];
    const penaltyCard = pool[Math.floor(Math.random() * pool.length)];
    handArr.push(penaltyCard);
    set(ref(db, `games/${roomId}/players/${currentName}/hand`), handArr);
    logAction(`❌ Mauvaise tentative de défausse rapide. Votre carte ${card} est conservée, et vous piochez une carte de pénalité (${penaltyCard}).`);
  }
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
    // Si Cactus a été déclaré et qu'on vient de donner la main à un autre joueur, on n'avance pas le tour ici
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
  // Masquer le bouton "Passer l'action spéciale"
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
    drawnCardP.style.display = "block";
    // Affiche le bouton "Défausser la carte" pour permettre de défausser sans échanger
    if (!document.getElementById("btn-discard-drawn")) {
      const discardBtn = document.createElement("button");
      discardBtn.id = "btn-discard-drawn";
      discardBtn.textContent = "Défausser la carte";
      discardBtn.addEventListener("click", discardDrawnCard);
      drawnCardP.after(discardBtn);
    }
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
    if (!document.getElementById("btn-discard-drawn")) {
      const discardBtn = document.createElement("button");
      discardBtn.id = "btn-discard-drawn";
      discardBtn.textContent = "Défausser la carte";
      discardBtn.addEventListener("click", discardDrawnCard);
      drawnCardP.after(discardBtn);
    }
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
  // Retire le bouton "Défausser la carte" de l'interface
  const discardButton = document.getElementById("btn-discard-drawn");
  if (discardButton) discardButton.remove();
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
  // Signale la déclaration de Cactus dans la base de données
  set(ref(db, `games/${roomId}/cactusCall`), { index: currentPlayerIndex });
  // Terminer le tour immédiatement après la déclaration
  endTurnProcedure();
}

// Dévoile les scores finaux et détermine le vainqueur de la manche
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
  // Réinitialise le signal de Cactus dans la base de données
  set(ref(db, `games/${roomId}/cactusCall`), null);
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
  // (Dans une implémentation complète, on supprimerait aussi l'état de la partie dans la base de données)
  document.getElementById("config").style.display = "block";
  document.getElementById("game").style.display = "none";
}

// Arrête la partie en cours et renvoie tous les joueurs au lobby
function stopGame() {
  if (!roomId) return;
  set(ref(db, `games/${roomId}/state`), "ended");
  document.getElementById("game").style.display = "none";
  document.getElementById("setup").style.display = "none";
  document.getElementById("lobby").style.display = "none";
  document.getElementById("config").style.display = "block";
  gameStarted = false;
  currentRound = 0;
  sessionStorage.removeItem("roomId");
  logAction("🏁 Vous avez arrêté la partie.");
}

// Surveille les changements du tour de jeu (joueur courant)
function watchTurn() {
  const turnRef = ref(db, `games/${roomId}/currentPlayer`);
  onValue(turnRef, (snapshot) => {
    const turn = snapshot.val();
    if (turn === null) return;
    currentPlayerIndex = turn;
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
    // Si Cactus a été déclaré et qu'on revient au joueur qui a dit Cactus, l'hôte déclenche le décompte final
    if (cactusDeclared && turn === cactusPlayerIndex) {
      // Bloquer les actions du joueur qui a déclaré Cactus (manche terminée)
      if (playerIndex === cactusPlayerIndex) {
        document.getElementById("btn-draw-card").disabled = true;
        document.getElementById("btn-discard-swap").disabled = true;
        document.getElementById("btn-declare-cactus").disabled = true;
      }
      if (isHost) {
        revealFinalScores();
      }
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

// Surveille l'état de la partie (pour passer du lobby à la config, puis au jeu, ou arrêt de partie)
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
      // Initialise les surveillances de tour, de défausse, de manche et de Cactus
      watchTurn();
      watchDiscard();
      watchRound();
      watchCactusCall();
      // L'hôte a déjà distribué les cartes et défini le joueur initial. Chez les autres joueurs, les données sont chargées via watchPlayers.
      // Affiche l'état de jeu initial
      currentRound = 1;
      updateScoreboard();
      renderGameArea();
      // Si ce joueur n'est pas l'hôte, masque les boutons de nouvelle manche et de réinitialisation
      if (!isHost) {
        document.getElementById("btn-new-round").style.display = "none";
        document.getElementById("btn-reset-game").style.display = "none";
      }
      logAction("🎮 La partie commence !");
    } else if (state === "ended") {
      // Retourne au lobby (fin de session)
      document.getElementById("game").style.display = "none";
      document.getElementById("setup").style.display = "none";
      document.getElementById("lobby").style.display = "none";
      document.getElementById("config").style.display = "block";
      gameStarted = false;
      currentRound = 0;
      sessionStorage.removeItem("roomId");
      logAction("🏁 La partie a été arrêtée par un joueur.");
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
      // Lance la phase de mémoire au début de chaque nouvelle manche (si configurée)
      if (((currentRound === 0 && roundNum === 1) || roundNum === currentRound + 1) &&
          playersData[username] && playersData[username].hand) {
        startInitialPeek();
      }
      currentRound = roundNum;
      updateScoreboard();
    }
  });
}

// Surveille la déclaration de "Cactus" dans la base de données
function watchCactusCall() {
  const cactusRef = ref(db, `games/${roomId}/cactusCall`);
  onValue(cactusRef, (snapshot) => {
    const data = snapshot.val();
    if (data && data.index) {
      cactusDeclared = true;
      cactusPlayerIndex = data.index;
    } else {
      // Réinitialise les indicateurs Cactus si la valeur est remise à zéro
      cactusDeclared = false;
      cactusPlayerIndex = null;
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
        logAction("👀 Vous avez regardé vos " + toReveal + " carte(s) de départ.");
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
  const playerNameElem = document.getElementById("player-name");
  if (playerNameElem) {
    playerNameElem.innerText = username;
  }
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
  // Crée le nœud de jeu dans la base de données
  const playerData = {};
  playerData[username] = { index: 1, score: 0 };
  await set(ref(db, `games/${roomId}/players`), playerData);
  await set(ref(db, `games/${roomId}/state`), "lobby");
  document.getElementById("config").style.display = "none";
  document.getElementById("lobby").style.display = "block";
  document.getElementById("lobby-room").innerText = roomId;
  logAction("🆕 Salle de jeu créée : " + roomId);
  watchPlayers();
  watchGameState();
}

// Rejoint une partie existante
async function joinRoom() {
  roomId = document.getElementById("room-code").value.trim().toUpperCase();
  if (!roomId) {
    return alert("Entrez un code de partie.");
  }
  username = username || sessionStorage.getItem("username") || "Joueur";
  try {
    const snapshot = await get(ref(db, `games/${roomId}/players`));
    if (!snapshot.exists()) {
      return alert("Aucune partie trouvée avec ce code.");
    }
    const players = snapshot.val();
    const playerIndexNums = Object.values(players).map(p => p.index);
    const newIndex = Math.max(...playerIndexNums) + 1;
    players[username] = { index: newIndex, score: 0 };
    await set(ref(db, `games/${roomId}/players`), players);
    sessionStorage.setItem("roomId", roomId);
    sessionStorage.setItem("username", username);
    sessionStorage.setItem("isHost", "false");
    document.getElementById("config").style.display = "none";
    document.getElementById("lobby").style.display = "block";
    document.getElementById("lobby-room").innerText = roomId;
    logAction("🔗 Rejoint la partie " + roomId);
    isHost = false;
    watchPlayers();
    watchGameState();
  } catch (e) {
    alert("Erreur lors de la connexion à la partie : " + e);
  }
}

// Lance l'écran de configuration de partie (hôte)
function launchSetup() {
  document.getElementById("lobby").style.display = "none";
  document.getElementById("setup").style.display = "block";
}

// Enregistre la configuration de la partie (cartes, score cible)
function saveGameConfig() {
  startVisibleCount = parseInt(document.getElementById("visible-count").value) || 2;
  cardCount = parseInt(document.getElementById("card-count").value) || 4;
  targetScore = parseInt(document.getElementById("target-score").value) || 3;
  logAction(`💾 Configuration : ${cardCount} cartes, ${startVisibleCount} visibles, cible ${targetScore} manches.`);
}

// Démarre la partie (clic "Lancer la partie" par l'hôte)
function startGame() {
  if (!isHost) return;
  // Enregistre la configuration de la partie dans la base
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
    // S'assure que chaque joueur a un champ score (0 par défaut s'il n'existe pas)
    updates[`games/${roomId}/players/${name}/score`] = playersData[name].score ?? 0;
  }
  // Initialise l'état de jeu : vide la défausse, manche 1, et démarre la partie
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
  // Le joueur 1 (hôte) commence chaque nouvelle manche
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
document.getElementById("btn-stop-game").addEventListener("click", stopGame);
document.getElementById("btn-new-round").addEventListener("click", startNewRound);
document.getElementById("btn-reset-game").addEventListener("click", resetGame);

// Au chargement de la page, si une session existe, reprendre la connexion automatiquement
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
