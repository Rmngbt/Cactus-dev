// Import des modules Firebase (SDK modulaire)
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.5.0/firebase-app.js";
import { getDatabase, ref, set, update, onValue, get } from "https://www.gstatic.com/firebasejs/11.5.0/firebase-database.js";

// Configuration Firebase
const firebaseConfig = {
  apiKey: "...",  // (identique à la config fournie)
  authDomain: "cactus-game-12ae9.firebaseapp.com",
  projectId: "cactus-game-12ae9",
  storageBucket: "cactus-game-12ae9.appspot.com",
  messagingSenderId: "852427558969",
  appId: "1:852427558969:web:0b292c74c6305dc348fde8",
  databaseURL: "https://cactus-game-12ae9-default-rtdb.firebaseio.com/"
};
// Initialisation de Firebase
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// Variables d'état globales
let roomId = null;
let username = null;
let isHost = false;
let playerIndex = null;
let playerCount = 0;
let playersData = {};
let playersByIndex = {};
let currentPlayerIndex = null;
let cardCount = 4;
let startVisibleCount = 2;
let targetScore = 3;
let currentRound = 0;
let gameStarted = false;
let drawnCard = null;
let currentDiscard = null;
let specialAction = false;
let pendingSpecial = null;
let selectedForSwap = null;
let cactusDeclared = false;
let cactusPlayerIndex = null;
// Flags pour attacher les watchers une seule fois
let turnWatcherActive = false;
let discardWatcherActive = false;
let resultWatcherActive = false;

// Ajoute un message dans le panneau de log
function logAction(msg) {
  const logDiv = document.getElementById("log");
  if (logDiv) {
    logDiv.innerHTML += `<p>${msg}</p>`;
  }
  console.log(msg);
}

// Met à jour le tableau des scores (scoreboard)
function updateScoreboard() {
  const board = document.getElementById("scoreboard");
  if (!board || !playersData) return;
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
    // Conteneur pour le jeu d'un joueur
    const playerDiv = document.createElement("div");
    playerDiv.className = "player-area";
    // Nom du joueur (indiquer "(Vous)" pour soi-même)
    const label = document.createElement("h3");
    label.textContent = (name === username) ? `${name} (Vous)` : name;
    playerDiv.appendChild(label);
    // Cartes du joueur
    hand.forEach((cardValue, idx) => {
      const wrapper = document.createElement("div");
      wrapper.className = "card-wrapper";
      // Carte face cachée
      const cardEl = document.createElement("div");
      cardEl.className = "card";
      cardEl.innerText = "?";
      // Attributs data pour identifier la carte
      cardEl.dataset.player = String(playersData[name].index);
      cardEl.dataset.index = String(idx);
      // Événement click sur la carte (gestion échange ou effets spéciaux)
      cardEl.addEventListener("click", onCardClick);
      // Bouton de défausse rapide "🗑"
      const quickBtn = document.createElement("button");
      quickBtn.innerText = "🗑";
      quickBtn.className = "quick-discard-btn";
      quickBtn.dataset.player = String(playersData[name].index);
      quickBtn.dataset.index = String(idx);
      quickBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        attemptQuickDiscard(playersData[name].index, idx);
      });
      wrapper.appendChild(cardEl);
      wrapper.appendChild(quickBtn);
      playerDiv.appendChild(wrapper);
    });
    area.appendChild(playerDiv);
  }
}

// Gestion du clic sur une carte (échange de carte piochée ou effets spéciaux)
function onCardClick(event) {
  const cardEl = event.currentTarget;
  const player = parseInt(cardEl.dataset.player);
  const index = parseInt(cardEl.dataset.index);
  if (isNaN(player) || isNaN(index) || !playersData) return;
  const name = playersByIndex[player];
  const handArray = playersData[name]?.hand;
  if (!handArray) return;

  // Si un effet spécial est en cours (8 = regarder sa carte, 10 = regarder adverse, V = échange)
  if (specialAction && pendingSpecial === 8 && player === currentPlayerIndex) {
    // 8 (Huit) : révéler temporairement l'une de ses propres cartes
    if (selectedForSwap !== null) return;
    selectedForSwap = true;
    const value = handArray[index];
    cardEl.innerText = value;
    logAction("👁 Carte révélée : " + value);
    setTimeout(() => {
      cardEl.innerText = "?";
      selectedForSwap = null;
      skipSpecial();
    }, 5000);
    return;
  }
  if (specialAction && pendingSpecial === 10 && player !== currentPlayerIndex) {
    // 10 (Dix) : révéler temporairement la carte d'un adversaire
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
    // Valet : échanger une carte avec un adversaire
    if (!selectedForSwap && player === currentPlayerIndex) {
      // Premier clic : sélection de la carte du joueur courant à échanger
      selectedForSwap = { player, index };
      logAction("👉 Sélectionnez une carte adverse à échanger avec la vôtre.");
      return;
    }
    if (selectedForSwap && player !== currentPlayerIndex) {
      // Second clic : sélection de la carte adverse, on effectue l'échange
      const myIndex = selectedForSwap.index;
      const opponentName = playersByIndex[player];
      const myName = playersByIndex[selectedForSwap.player];
      if (!playersData[myName] || !playersData[opponentName]) return;
      const myHand = [...playersData[myName].hand];
      const oppHand = [...playersData[opponentName].hand];
      // Échange des valeurs
      const temp = myHand[myIndex];
      myHand[myIndex] = oppHand[index];
      oppHand[index] = temp;
      // Mise à jour des deux mains dans la base
      const updates = {};
      updates[`games/${roomId}/players/${myName}/hand`] = myHand;
      updates[`games/${roomId}/players/${opponentName}/hand`] = oppHand;
      update(ref(db), updates);
      selectedForSwap = null;
      logAction("🔄 Cartes échangées entre " + myName + " et " + opponentName);
      // Fin de l'effet spécial (termine le tour en cours)
      skipSpecial();
      return;
    }
  }

  // Tour normal du joueur : échange d'une carte piochée avec une de sa main
  if (player !== currentPlayerIndex || drawnCard === null) {
    // Ignorer si ce n'est pas le tour du joueur ou s'il n'a pas de carte à échanger
    return;
  }
  // Échange la carte piochée avec la carte de la main cliquée
  const currentName = playersByIndex[currentPlayerIndex];
  const handArr = playersData[currentName]?.hand;
  if (!handArr) return;
  const replaced = handArr[index];
  // Place la nouvelle carte dans la main et met l'ancienne carte dans la défausse
  handArr[index] = drawnCard;
  const oldCard = replaced;
  const newCard = drawnCard;
  drawnCard = null;
  // Mise à jour de la main du joueur et de la défausse dans Firebase
  set(ref(db, `games/${roomId}/players/${currentName}/hand`), handArr);
  set(ref(db, `games/${roomId}/discard`), oldCard);
  // Masque l'affichage de la carte piochée et journalise l'échange
  document.getElementById("drawn-card").style.display = "none";
  logAction(`🔄 Carte échangée : ${oldCard} ↔ ${newCard}`);
  // Vérifie un éventuel effet spécial sur la carte défaussée
  const hadSpecial = handleSpecialCard(oldCard);
  // Fin du tour si aucune action spéciale n’est déclenchée
  if (!hadSpecial) {
    endTurnProcedure();
  }
}

// Tente une défausse rapide (hors de son tour) sur la carte ciblée
function attemptQuickDiscard(targetPlayerIndex, cardIdx) {
  // Un joueur ne peut pas faire de défausse rapide pendant son propre tour
  if (currentPlayerIndex === playerIndex) {
    return logAction("⛔ Vous ne pouvez pas défausser rapidement pendant votre tour.");
  }
  if (currentDiscard === null) {
    return logAction("❌ Aucune carte dans la défausse.");
  }
  const targetName = playersByIndex[targetPlayerIndex];
  if (!targetName || !playersData[targetName] || !playersData[targetName].hand) return;
  const targetHand = [...playersData[targetName].hand];
  const cardValue = targetHand[cardIdx];
  // Normaliser pour comparer les valeurs (compte tenu des nombres/figures)
  const normalize = (val) => (typeof val === "number" ? val : isNaN(val) ? val : parseInt(val));
  if (normalize(cardValue) === normalize(currentDiscard)) {
    // ✅ Succès : la carte de la main correspond à la défausse, on la retire de la main
    targetHand.splice(cardIdx, 1);
    const updates = {};
    updates[`games/${roomId}/players/${targetName}/hand`] = targetHand;
    updates[`games/${roomId}/discard`] = cardValue;
    logAction(`⚡ Défausse rapide réussie : carte ${cardValue} défaussée${targetName === username ? "" : " depuis la main de " + targetName} !`);
    if (targetPlayerIndex !== playerIndex) {
      // Si on défausse la carte d'un adversaire, on lui donne en échange notre carte la plus haute (pénalité pour le joueur actif)
      const myName = username;
      const myHand = [...playersData[myName].hand];
      if (myHand.length > 0) {
        // Choisir la carte de valeur la plus élevée dans sa main
        let maxIndex = 0;
        let maxVal = -Infinity;
        for (let i = 0; i < myHand.length; i++) {
          const val = getCardValue(myHand[i]);
          if (val > maxVal) {
            maxVal = val;
            maxIndex = i;
          }
        }
        const cardToGive = myHand.splice(maxIndex, 1)[0];
        updates[`games/${roomId}/players/${targetName}/hand`] = [...targetHand, cardToGive];
        updates[`games/${roomId}/players/${myName}/hand`] = myHand;
        logAction(`🔁 Vous donnez votre carte ${cardToGive} à ${targetName}.`);
      }
    }
    update(ref(db), updates);
  } else {
    // ❌ Échec : la carte ne correspond pas, le joueur actif pioche une carte de pénalité
    const myName = username;
    const myHand = [...(playersData[myName]?.hand || [])];
    const pool = ["R","A",2,3,4,5,6,7,8,9,10,"V","D"];
    const penaltyCard = pool[Math.floor(Math.random() * pool.length)];
    myHand.push(penaltyCard);
    set(ref(db, `games/${roomId}/players/${myName}/hand`), myHand);
    logAction(`❌ Défausse rapide ratée ! Vous piochez une carte de pénalité (${penaltyCard}).`);
  }
}

// Pioche une nouvelle carte depuis la pioche
function drawCard() {
  if (currentPlayerIndex !== playerIndex) {
    return logAction("⛔ Ce n'est pas votre tour de jouer !");
  }
  if (drawnCard !== null) {
    return logAction("⏳ Vous avez déjà une carte piochée en attente.");
  }
  const pool = ["R","A",2,3,4,5,6,7,8,9,10,"V","D"];
  drawnCard = pool[Math.floor(Math.random() * pool.length)];
  logAction("🃏 Carte piochée : " + drawnCard);
  // Affiche la carte piochée à l'écran pour le joueur qui l'a piochée
  const newCardSpan = document.getElementById("new-card");
  const drawnCardP = document.getElementById("drawn-card");
  if (newCardSpan && drawnCardP) {
    newCardSpan.innerText = drawnCard;
    drawnCardP.style.display = "block";
  }
}

// Récupère la carte au sommet de la défausse
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
  // On prend la carte de la défausse comme carte piochée
  drawnCard = currentDiscard;
  // Retire cette carte de la défausse (qui devient vide)
  set(ref(db, `games/${roomId}/discard`), null);
  logAction("🔁 Carte récupérée de la défausse : " + drawnCard);
  // Affiche la carte récupérée pour le joueur actif
  const newCardSpan = document.getElementById("new-card");
  const drawnCardP = document.getElementById("drawn-card");
  if (newCardSpan && drawnCardP) {
    newCardSpan.innerText = drawnCard;
    drawnCardP.style.display = "block";
  }
}

// Défausse la carte piochée en cours (sans l'échanger)
function discardDrawnCard() {
  if (drawnCard === null) return;
  const card = drawnCard;
  drawnCard = null;
  set(ref(db, `games/${roomId}/discard`), card);
  logAction("🗑 Carte défaussée : " + card);
  const hadSpecial = handleSpecialCard(card);
  // Masque l'affichage de la carte piochée
  document.getElementById("drawn-card").style.display = "none";
  // Si aucun effet spécial, on termine le tour immédiatement
  if (!hadSpecial) {
    endTurnProcedure();
  }
}

// Vérifie si une carte défaussée déclenche un effet spécial (retourne true si oui)
function handleSpecialCard(card) {
  specialAction = false;
  pendingSpecial = null;
  if (card === 8) {  // Huit
    specialAction = true;
    pendingSpecial = 8;
    document.getElementById("skip-special").style.display = "inline-block";
    logAction("👁 Effet spécial : regardez une de vos cartes.");
    return true;
  }
  if (card === 10) { // Dix
    specialAction = true;
    pendingSpecial = 10;
    document.getElementById("skip-special").style.display = "inline-block";
    logAction("🔍 Effet spécial : regardez une carte d'un adversaire.");
    return true;
  }
  if (card === "V") { // Valet
    specialAction = true;
    pendingSpecial = "V";
    document.getElementById("skip-special").style.display = "inline-block";
    logAction("🔄 Effet spécial : échangez une de vos cartes avec un adversaire.");
    return true;
  }
  return false;
}

// Termine le tour courant et passe au joueur suivant (ou termine la manche si Cactus)
function endTurnProcedure() {
  if (specialAction) {
    // Ne pas terminer le tour tant qu'un effet spécial est en cours
    return;
  }
  if (cactusDeclared && currentPlayerIndex !== cactusPlayerIndex) {
    // Cactus déclaré : si ce n'est pas encore revenu au joueur qui a dit Cactus, on n'avance pas automatiquement (on attend les autres joueurs)
    return;
  }
  // Passe au tour du joueur suivant
  const nextIndex = currentPlayerIndex ? (currentPlayerIndex % playerCount) + 1 : 1;
  set(ref(db, `games/${roomId}/currentPlayer`), nextIndex);
}

// "Passer" une action spéciale en cours (annule l'effet spécial et termine le tour)
function skipSpecial() {
  specialAction = false;
  pendingSpecial = null;
  selectedForSwap = null;
  const skipBtn = document.getElementById("skip-special");
  if (skipBtn) skipBtn.style.display = "none";
  logAction("⏭ Action spéciale terminée");
  endTurnProcedure();
}

// Déclare "Cactus" (fin de manche initiée par le joueur)
function declareCactus() {
  if (cactusDeclared) return;
  cactusDeclared = true;
  cactusPlayerIndex = currentPlayerIndex;
  logAction("🌵 Joueur " + currentPlayerIndex + " dit Cactus !");
  endTurnProcedure();
}

// Révèle les scores finaux de la manche et détermine le gagnant (appelé côté hôte)
function revealFinalScores() {
  // Calcule le total de points de chaque joueur (somme des valeurs des cartes)
  const sumHand = (cards) => cards.reduce((total, c) => total + getCardValue(c), 0);
  let totals = {};
  for (let name in playersData) {
    const hand = playersData[name].hand || [];
    totals[name] = sumHand(hand);
    logAction("🧮 " + name + " : " + totals[name]);
    // Vérifie le "Cactus Royal" (toutes les cartes R = 0 points)
    if (hand.length > 0 && hand.every(c => c === "R")) {
      logAction("👑 " + name + " a un Cactus Royal !");
    }
  }
  // Détermine le gagnant de la manche (si <=5 points, le plus bas gagne, égalité si égal)
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
        winnerName = null;
      }
    }
  }
  let resultMsg;
  if (!success) {
    logAction("❌ Aucun joueur n’a réussi le Cactus.");
    resultMsg = "❌ Aucun joueur n’a réussi le Cactus.";
  } else if (!winnerName) {
    logAction("🤝 Égalité ! Pas de gagnant pour cette manche.");
    resultMsg = "🤝 Égalité ! Pas de gagnant pour cette manche.";
  } else {
    logAction("🏆 " + winnerName + " remporte la manche !");
    resultMsg = "🏆 " + winnerName + " remporte la manche !";
    // Incrémente le score du gagnant
    const newScore = (playersData[winnerName].score || 0) + 1;
    set(ref(db, `games/${roomId}/players/${winnerName}/score`), newScore);
    // Si le score cible est atteint, annonce le vainqueur de la partie
    if (newScore >= targetScore) {
      logAction("🎉 " + winnerName + " remporte la partie !");
      document.getElementById("btn-reset-game").style.display = "inline-block";
      document.getElementById("btn-new-round").style.display = "none";
    }
  }
  // Envoie le message de résultat de manche dans la base pour affichage à tous
  set(ref(db, `games/${roomId}/resultMessage`), resultMsg);
  // Fin de manche : préparer le bouton Nouvelle manche (si la partie n'est pas terminée)
  if (isHost) {
    cactusDeclared = false;
    cactusPlayerIndex = null;
    if (document.getElementById("btn-new-round")) {
      document.getElementById("btn-new-round").style.display = "inline-block";
    }
  }
}

// Donne la valeur numérique d’une carte pour le calcul du score
function getCardValue(card) {
  if (card === "R") return 0;
  if (card === "A") return 1;
  if (card === 2) return -2;
  if (card === "V" || card === "D" || card === 10) return 10;
  if (typeof card === "number") return card;
  return 10;
}

// Réinitialise entièrement la partie (retour à l'écran d'accueil)
function resetGame() {
  if (!isHost) return;
  // Remet l'état de la partie à "lobby" dans la base (optionnellement on pourrait supprimer la partie dans la base)
  const updates = {};
  updates[`games/${roomId}/state`] = "lobby";
  updates[`games/${roomId}/currentPlayer`] = null;
  update(ref(db), updates);
  // Revient à l'écran d'accueil côté hôte
  document.getElementById("lobby").style.display = "block";
  document.getElementById("config").style.display = "none";
  document.getElementById("setup").style.display = "none";
  document.getElementById("game").style.display = "none";
  document.getElementById("btn-reset-game").style.display = "none";
  document.getElementById("btn-new-round").style.display = "none";
  document.getElementById("log").innerHTML = "";
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

// Surveillance en temps réel des données Firebase

// Suivre les changements du joueur courant (tour par tour)
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
    const isMyTurn = (turn === playerIndex);
    document.getElementById("btn-draw-card").disabled = !isMyTurn;
    document.getElementById("btn-discard-swap").disabled = !isMyTurn;
    document.getElementById("btn-declare-cactus").disabled = !isMyTurn;
    logAction("🔄 Tour du joueur " + turn);
    // Si Cactus a été déclaré et qu'on revient au joueur initial, l'hôte calcule les scores finaux
    if (cactusDeclared && turn === cactusPlayerIndex && isHost) {
      revealFinalScores();
    }
  });
}

// Suivre les changements dans la liste des joueurs (leurs mains, scores, etc.)
function watchPlayers() {
  const playersRef = ref(db, `games/${roomId}/players`);
  onValue(playersRef, (snapshot) => {
    const data = snapshot.val();
    if (!data) return;
    playersData = data;
    // Reconstitue le mapping index->nom et compte les joueurs
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
    // Met à jour l'UI en fonction de l'état du jeu
    if (!gameStarted) {
      // Dans le lobby : liste les joueurs
      const listElem = document.getElementById("lobby-players");
      if (listElem) {
        const names = Object.keys(data);
        if (names.length > 0) {
          listElem.innerHTML = "<ul>" + names.map(n =>
            `<li>${n}${data[n].index === 1 ? " (hôte)" : ""}</li>`
          ).join("") + "</ul>";
        }
      }
      // Affiche le bouton Lancer la partie à l'hôte si au moins 2 joueurs
      const startBtn = document.getElementById("start-game");
      if (startBtn) {
        startBtn.style.display = (isHost && Object.keys(data).length >= 2) ? "inline-block" : "none";
      }
    } else {
      // En jeu : met à jour le scoreboard et réaffiche les cartes
      updateScoreboard();
      renderGameArea();
      // Si un joueur n'a plus de cartes, terminer la manche (cas particulier)
      if (isHost) {
        for (const pname in data) {
          if (data[pname].hand && data[pname].hand.length === 0) {
            revealFinalScores();
            break;
          }
        }
      }
    }
  });
}

// Suivre les changements d'état de la partie (lobby -> setup -> playing -> lobby)
function watchGameState() {
  const stateRef = ref(db, `games/${roomId}/state`);
  onValue(stateRef, (snapshot) => {
    const state = snapshot.val();
    if (!state) return;
    if (state === "setup") {
      // Passage du lobby à l'écran de configuration
      document.getElementById("lobby").style.display = "none";
      document.getElementById("setup").style.display = "block";
      logAction("🟢 Configuration de la partie en cours...");
    } else if (state === "playing") {
      // Démarrage de la partie (ou nouvelle manche) pour tous les joueurs
      document.getElementById("lobby").style.display = "none";
      document.getElementById("setup").style.display = "none";
      document.getElementById("game").style.display = "block";
      gameStarted = true;
      // Réinitialise les indicateurs de manche
      cactusDeclared = false;
      cactusPlayerIndex = null;
      // Active les watchers de tour, défausse, résultat (une seule fois)
      if (!turnWatcherActive) {
        watchTurn();
        turnWatcherActive = true;
      }
      if (!discardWatcherActive) {
        watchDiscard();
        discardWatcherActive = true;
      }
      if (!resultWatcherActive) {
        watchResult();
        resultWatcherActive = true;
      }
      // Met à jour le score, les cartes, et le numéro de manche courant
      currentRound = (currentRound === 0 ? 1 : currentRound);
      updateScoreboard();
      renderGameArea();
      // Masque les boutons "Nouvelle manche" et "Nouvelle partie" pour les non-hôtes
      if (!isHost) {
        document.getElementById("btn-new-round").style.display = "none";
        document.getElementById("btn-reset-game").style.display = "none";
      }
      // Chaque joueur peut regarder ses cartes initiales si non déjà fait
      if (playersData[username] && playersData[username].hand && playersData[username].peekDone !== true) {
        startInitialPeek();
      }
      logAction("🎮 La partie commence !");
    } else if (state === "lobby") {
      // Retour à l'écran d'accueil/lobby (après un reset de partie)
      document.getElementById("game").style.display = "none";
      document.getElementById("setup").style.display = "none";
      document.getElementById("lobby").style.display = "block";
      // Réinitialisation éventuelle déjà gérée dans resetGame()
    }
  });
}

// Suivre la carte de défausse (sommet de la pile)
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

// Suivre le message de résultat de manche (affichage du gagnant)
function watchResult() {
  const resRef = ref(db, `games/${roomId}/resultMessage`);
  onValue(resRef, (snapshot) => {
    const message = snapshot.val();
    const deckBtn = document.getElementById("btn-draw-card");
    const discardBtn = document.getElementById("btn-discard-swap");
    let winnerMsgElem = document.getElementById("winner-message");
    if (message) {
      // Cache les boutons de pioche/échange et affiche le message central
      if (deckBtn) deckBtn.style.display = "none";
      if (discardBtn) discardBtn.style.display = "none";
      if (!winnerMsgElem) {
        winnerMsgElem = document.createElement("div");
        winnerMsgElem.id = "winner-message";
        winnerMsgElem.className = "winner-message";
        document.getElementById("game")?.appendChild(winnerMsgElem);
      }
      winnerMsgElem.innerText = message;
      winnerMsgElem.style.display = "block";
    } else {
      // Cache le message de résultat et réaffiche les boutons de jeu
      if (winnerMsgElem) {
        winnerMsgElem.style.display = "none";
      }
      if (deckBtn) deckBtn.style.display = "inline-block";
      if (discardBtn) discardBtn.style.display = "inline-block";
    }
  });
}

// Permet à chaque joueur de regarder ses cartes de départ (cartes initiales)
function startInitialPeek() {
  const myCards = document.querySelectorAll(`#game-area .card[data-player="${playerIndex}"]`);
  let revealed = 0;
  const toReveal = Math.min(startVisibleCount, myCards.length);
  if (toReveal <= 0) return;
  logAction(`👆 Sélectionnez ${toReveal} carte(s) à regarder (cartes de départ).`);
  myCards.forEach((cardEl) => {
    if (parseInt(cardEl.dataset.player) !== playerIndex) return;
    cardEl.classList.add("selectable-start");
    const handler = () => {
      if (revealed >= toReveal) return;
      const idx = parseInt(cardEl.dataset.index);
      const myHand = playersData[username]?.hand;
      if (!myHand) return;
      cardEl.innerText = myHand[idx];
      cardEl.classList.add("highlight");
      revealed++;
      if (revealed === toReveal) {
        logAction(`👀 Vous avez regardé vos ${toReveal} carte(s) de départ.`);
        // Marque dans la base que ce joueur a terminé de regarder ses cartes initiales
        set(ref(db, `games/${roomId}/players/${username}/peekDone`), true);
        // Cache de nouveau les cartes après 5 secondes
        setTimeout(() => {
          myCards.forEach(c => {
            c.innerText = "?";
            c.classList.remove("highlight", "selectable-start");
            c.removeEventListener("click", handler);
          });
          logAction("🕑 Vos cartes sont à nouveau cachées.");
        }, 5000);
      }
    };
    cardEl.addEventListener("click", handler);
  });
}

// *** Gestion des interactions utilisateur (connexion, création, rejoindre, etc.) ***

// Connexion de l'utilisateur avec son pseudo
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
  if (document.getElementById("player-name")) {
    document.getElementById("player-name").innerText = username;
  }
  logAction("👋 Bienvenue, " + username + " !");
}

// Création d'une nouvelle salle de jeu
async function createRoom() {
  // Génère un code de partie aléatoire à 6 caractères
  const code = Math.random().toString(36).substring(2, 8).toUpperCase();
  roomId = code;
  isHost = true;
  username = username || sessionStorage.getItem("username") || "Hôte";
  sessionStorage.setItem("roomId", roomId);
  sessionStorage.setItem("username", username);
  sessionStorage.setItem("isHost", "true");
  // Initialise la salle dans la base : ajoute l'hôte (index 1)
  await set(ref(db, `games/${roomId}/players/${username}`), { connected: true, index: 1, score: 0 });
  await set(ref(db, `games/${roomId}/host`), username);
  // Définit le tour courant à 1 (hôte) dans la base
  await set(ref(db, `games/${roomId}/currentPlayer`), 1);
  // Affiche l'écran du lobby
  document.getElementById("config").style.display = "none";
  document.getElementById("lobby").style.display = "block";
  document.getElementById("lobby-room").innerText = roomId;
  logAction("🔧 Partie créée. Code : " + roomId);
  logAction("👤 Joueur ajouté : " + username + " (hôte)");
  // Démarre l'écoute des joueurs et de l'état de jeu
  watchPlayers();
  watchGameState();
}

// Rejoindre une partie existante via un code
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
  // Récupère le nombre de joueurs actuel et assigne le prochain index
  try {
    const snapshot = await get(ref(db, `games/${roomId}/players`));
    if (!snapshot.exists()) {
      return alert("Code de partie introuvable.");
    }
    const currentPlayers = snapshot.val();
    const count = Object.keys(currentPlayers).length;
    const newIndex = count + 1;
    // Ajoute ce joueur dans la salle
    await set(ref(db, `games/${roomId}/players/${username}`), { connected: true, index: newIndex, score: 0 });
  } catch (err) {
    console.error("Join room error:", err);
    return alert("Impossible de rejoindre la partie. Vérifiez le code.");
  }
  // Affiche l'écran du lobby
  document.getElementById("config").style.display = "none";
  document.getElementById("lobby").style.display = "block";
  document.getElementById("lobby-room").innerText = roomId;
  logAction("🔗 Rejoint la partie : " + roomId);
  logAction("👤 Joueur ajouté : " + username);
  // Démarre l'écoute des joueurs et de l'état de jeu
  watchPlayers();
  watchGameState();
}

// Lancement de l'écran de configuration (hôte clique sur "Lancer la partie" dans le lobby)
function launchSetup() {
  if (!isHost) return;
  set(ref(db, `games/${roomId}/state`), "setup");
  // (L'UI de configuration sera affichée via watchGameState sur tous les clients)
}

// Enregistrer la configuration de la partie (hôte)
function saveGameConfig() {
  if (!isHost) return;
  // Lit les valeurs des inputs de configuration
  cardCount = parseInt(document.getElementById("card-count").value) || 4;
  startVisibleCount = parseInt(document.getElementById("visible-count").value) || 2;
  targetScore = parseInt(document.getElementById("target-score").value) || 3;
  logAction(`💾 Configuration : ${cardCount} cartes, ${startVisibleCount} visibles, objectif ${targetScore} manche(s) gagnante(s).`);
  // (La config sera enregistrée dans la base lors du démarrage de la partie)
}

// Démarrer la partie (hôte clique sur "Lancer la partie" dans l'écran de configuration)
function startGame() {
  if (!isHost) return;
  // Enregistre la configuration choisie dans la base (pour référence)
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
    // Initialise le champ score si non présent
    updates[`games/${roomId}/players/${name}/score`] = playersData[name].score ?? 0;
    // Indique que le joueur n'a pas encore regardé ses cartes de départ
    updates[`games/${roomId}/players/${name}/peekDone`] = false;
  }
  // Initialise la défausse vide, la manche #1 et l'état "playing"
  updates[`games/${roomId}/discard`] = null;
  updates[`games/${roomId}/round`] = 1;
  updates[`games/${roomId}/state`] = "playing";
  update(ref(db), updates);
  currentRound = 1;
  // Ajustements UI côté hôte
  gameStarted = true;
  document.getElementById("btn-new-round").style.display = "none";
  document.getElementById("btn-reset-game").style.display = "none";
  logAction("🃏 Cartes distribuées. La partie va commencer !");
}

// Démarrer une nouvelle manche (hôte clique sur "Nouvelle manche")
function startNewRound() {
  if (!isHost) return;
  currentRound += 1;
  // Réinitialise les flags de manche
  cactusDeclared = false;
  cactusPlayerIndex = null;
  specialAction = false;
  pendingSpecial = null;
  selectedForSwap = null;
  drawnCard = null;
  // Distribue de nouvelles mains aléatoires
  const deckValues = ["R","A",2,3,4,5,6,7,8,9,10,"V","D"];
  const updates = {};
  for (let name in playersData) {
    const newHand = [];
    for (let i = 0; i < cardCount; i++) {
      newHand.push(deckValues[Math.floor(Math.random() * deckValues.length)]);
    }
    updates[`games/${roomId}/players/${name}/hand`] = newHand;
    updates[`games/${roomId}/players/${name}/peekDone`] = false;
  }
  updates[`games/${roomId}/discard`] = null;
  updates[`games/${roomId}/round`] = currentRound;
  updates[`games/${roomId}/state`] = "playing";
  update(ref(db), updates);
  // Masque le bouton de nouvelle manche en attendant la fin de cette manche
  document.getElementById("btn-new-round").style.display = "none";
  logAction("🔁 Nouvelle manche commencée (Manche " + currentRound + ").");
}

// Écouteurs d'événements sur les éléments de l'interface
document.getElementById("btn-login").addEventListener("click", login);
document.getElementById("btn-create-room").addEventListener("click", createRoom);
document.getElementById("btn-join-room").addEventListener("click", joinRoom);
document.getElementById("start-game").addEventListener("click", launchSetup);
document.getElementById("btn-save-config").addEventListener("click", saveGameConfig);
document.getElementById("btn-start-game").addEventListener("click", startGame);
document.getElementById("btn-draw-card").addEventListener("click", drawCard);
document.getElementById("btn-discard-swap").addEventListener("click", takeDiscard);
document.getElementById("skip-special").addEventListener("click", skipSpecial);
document.getElementById("btn-declare-cactus").addEventListener("click", declareCactus);
document.getElementById("btn-new-round").addEventListener("click", startNewRound);
document.getElementById("btn-reset-game").addEventListener("click", resetGame);

// Reconnexion automatique si l'utilisateur revient sur la page avec une partie en cours
window.addEventListener("load", () => {
  const savedRoom = sessionStorage.getItem("roomId");
  const savedName = sessionStorage.getItem("username");
  const savedHost = sessionStorage.getItem("isHost");
  if (savedRoom && savedName) {
    roomId = savedRoom;
    username = savedName;
    isHost = (savedHost === "true");
    document.getElementById("welcome").style.display = "none";
    document.getElementById("config").style.display = "none";
    document.getElementById("lobby").style.display = "block";
    document.getElementById("lobby-room").innerText = roomId;
    logAction("🔗 Reconnexion à la partie " + roomId + " en cours...");
    watchPlayers();
    watchGameState();
  }
});

// Active les boutons Créer/Rejoindre dès l'initialisation Firebase terminée
document.getElementById("btn-create-room").disabled = false;
document.getElementById("btn-join-room").disabled = false;
