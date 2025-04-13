// Import Firebase modules (using modular SDK)
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.5.0/firebase-app.js";
import { getDatabase, ref, set, update, onValue, get } from "https://www.gstatic.com/firebasejs/11.5.0/firebase-database.js";

// Firebase configuration (from provided index_save.html)
const firebaseConfig = {
  apiKey: "AIzaSyBd2O4MWVNlY5MOVffdcvMrkj2lLxJcdv0",
  authDomain: "cactus-game-12ae9.firebaseapp.com",
  projectId: "cactus-game-12ae9",
  storageBucket: "cactus-game-12ae9.appspot.com",
  messagingSenderId: "852427558969",
  appId: "1:852427558969:web:0b292c74c6305dc348fde8",
  databaseURL: "https://cactus-game-12ae9-default-rtdb.firebaseio.com/"
};
// Initialize Firebase app and database
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// Global state variables
let roomId = null;
let username = null;
let isHost = false;
let playerIndex = null;             // This player's index (1..N in the room)
let playerCount = 0;
let playersData = {};              // Latest players data from DB (names, hands, scores, etc.)
let playersByIndex = {};           // Map player index -> name
let currentPlayerIndex = null;     // Whose turn it is (numeric index)
let cardCount = 4;
let startVisibleCount = 2;
let targetScore = 3;
let currentRound = 0;
let gameStarted = false;
let drawnCard = null;              // Card currently drawn by this player (if any)
let currentDiscard = null;         // Current top of discard pile
// Flags for special actions
let specialAction = false;
let pendingSpecial = null;
let selectedForSwap = null;        // Used for Jack effect: store selected card for swap
let cactusDeclared = false;
let cactusPlayerIndex = null;
let resultWatcherActive = false;   // To ensure watchResult is set only once

// Utility: Append a message to the log panel
function logAction(msg) {
  const logDiv = document.getElementById("log");
  if (logDiv) {
    logDiv.innerHTML += `<p>${msg}</p>`;
  }
  console.log(msg);
}

// Update the scoreboard UI with current scores and round
function updateScoreboard() {
  const board = document.getElementById("scoreboard");
  if (!board || !playersData) return;
  // Build score list sorted by player index
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

// Render all players' cards in the game area
function renderGameArea() {
  const area = document.getElementById("game-area");
  if (!area || !playersData) return;
  area.innerHTML = "";  // clear previous
  for (let i = 1; i <= playerCount; i++) {
    const name = playersByIndex[i];
    if (!name) continue;
    const hand = playersData[name].hand || [];
    // Create a container for this player's hand
    const playerDiv = document.createElement("div");
    playerDiv.className = "player-area";
    // Player label: show pseudonym (mark your own as "Vous")
    const label = document.createElement("h3");
    label.textContent = (name === username) ? `${name} (Vous)` : name;
    playerDiv.appendChild(label);
    // Cards
    hand.forEach((cardValue, idx) => {
      const wrapper = document.createElement("div");
      wrapper.className = "card-wrapper";
      // Create discard button
      const discardBtn = document.createElement("button");
      discardBtn.className = "discard-btn";
      discardBtn.textContent = "🗑";
      discardBtn.dataset.player = String(playersData[name].index);
      discardBtn.dataset.index = String(idx);
      discardBtn.addEventListener("click", onDiscardClick);
      // Create card element
      const cardEl = document.createElement("div");
      cardEl.className = "card";
      // Show face-down (unknown) card for all players (including your own, unless revealed momentarily by effects)
      cardEl.innerText = "?";
      // Tag with data attributes for event handler context
      cardEl.dataset.player = String(playersData[name].index);
      cardEl.dataset.index = String(idx);
      // Attach click handler for card actions (swap, special reveal, etc.)
      cardEl.addEventListener("click", onCardClick);
      // Append elements
      wrapper.appendChild(discardBtn);
      wrapper.appendChild(cardEl);
      playerDiv.appendChild(wrapper);
    });
    area.appendChild(playerDiv);
  }
}

// Handler for clicking a card (either your own or another's)
function onCardClick(event) {
  const cardEl = event.currentTarget;
  const player = parseInt(cardEl.dataset.player);
  const index = parseInt(cardEl.dataset.index);
  if (isNaN(player) || isNaN(index) || !playersData) return;
  const name = playersByIndex[player];
  const handArray = playersData[name]?.hand;
  if (!handArray) return;

  // If a special action is in progress, handle special cases
  if (specialAction && pendingSpecial === 8 && player === currentPlayerIndex) {
    // Reveal one of your own cards for 5 seconds
    if (selectedForSwap !== null) return;
    selectedForSwap = true;
    const value = handArray[index];
    cardEl.innerText = value;
    logAction("👁 Carte révélée : " + value);
    setTimeout(() => {
      cardEl.innerText = "?";
      selectedForSwap = null;
      // Finish special effect (skip to end turn)
      skipSpecial();
    }, 5000);
    return;
  }
  if (specialAction && pendingSpecial === 10 && player !== currentPlayerIndex) {
    // Reveal one opponent's card for 5 seconds
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
    // Jack effect: swap one of your cards with an opponent's
    if (!selectedForSwap && player === currentPlayerIndex) {
      // First click: select one of your own cards to swap
      selectedForSwap = { player, index };
      logAction("👉 Sélectionnez une carte adverse à échanger avec la vôtre.");
      return;
    }
    if (selectedForSwap && player !== currentPlayerIndex) {
      // Second click: on opponent's card, perform the swap
      const myIndex = selectedForSwap.index;
      const opponentName = playersByIndex[player];
      const myName = playersByIndex[selectedForSwap.player];
      if (!playersData[myName] || !playersData[opponentName]) return;
      const myHand = [...playersData[myName].hand];
      const oppHand = [...playersData[opponentName].hand];
      const temp = myHand[myIndex];
      myHand[myIndex] = oppHand[index];
      oppHand[index] = temp;
      // Update both players' hands in DB
      const updates = {};
      updates[`games/${roomId}/players/${myName}/hand`] = myHand;
      updates[`games/${roomId}/players/${opponentName}/hand`] = oppHand;
      update(ref(db), updates);
      selectedForSwap = null;
      logAction("🔄 Cartes échangées entre " + myName + " et " + opponentName);
      // End special effect and turn
      skipSpecial();
      return;
    }
  }

  // If not a special action, handle normal card click (for swapping drawn card)
  if (player !== currentPlayerIndex || drawnCard === null) {
    // Not the current player's turn or nothing to swap
    return;
  }
  // Current player clicked one of their own cards to swap with drawnCard
  const currentName = playersByIndex[currentPlayerIndex];
  const handArr = playersData[currentName]?.hand;
  if (!handArr) return;
  const replaced = handArr[index];
  // Perform swap: put drawn card into hand, send replaced card to discard
  handArr[index] = drawnCard;
  const oldCard = replaced;
  const newCard = drawnCard;
  drawnCard = null;
  // Update this player's hand in DB and the discard pile in DB
  set(ref(db, `games/${roomId}/players/${currentName}/hand`), handArr);
  set(ref(db, `games/${roomId}/discard`), oldCard);
  // Hide the drawn card UI and log the swap
  const drawnCardElem = document.getElementById("drawn-card");
  if (drawnCardElem) drawnCardElem.style.display = "none";
  logAction(`🔄 Carte échangée : ${oldCard} ↔ ${newCard}`);
  // Check for special effect on the discarded card
  handleSpecialCard(oldCard);
}

// Handler for clicking the discard button on a card (quick discard action)
function onDiscardClick(event) {
  event.stopPropagation();
  const btn = event.currentTarget;
  const player = parseInt(btn.dataset.player);
  const index = parseInt(btn.dataset.index);
  if (isNaN(player) || isNaN(index)) return;
  if (currentPlayerIndex === playerIndex) {
    // It's your turn: discard one of your own cards
    discardFromHand(player, index);
  } else {
    // Out-of-turn quick discard
    attemptQuickDiscard(player, index);
  }
}

// Attempt a quick discard of a card (out-of-turn)
function attemptQuickDiscard(targetIndex, cardIdx) {
  // Only allow if it's NOT your turn
  if (currentPlayerIndex === playerIndex) {
    return logAction("⛔ Vous ne pouvez pas défausser rapidement pendant votre tour.");
  }
  if (currentDiscard === null) {
    return logAction("❌ Aucune carte dans la défausse.");
  }
  const targetName = playersByIndex[targetIndex];
  if (!targetName || !playersData[targetName] || !playersData[targetName].hand) return;
  const targetHand = [...playersData[targetName].hand];
  const cardValue = targetHand[cardIdx];
  const normalize = (val) => (typeof val === "number" ? val : isNaN(val) ? val : parseInt(val));
  if (normalize(cardValue) === normalize(currentDiscard)) {
    // Quick discard success: remove the matching card and update discard
    targetHand.splice(cardIdx, 1);
    const updates = {};
    updates[`games/${roomId}/players/${targetName}/hand`] = targetHand;
    updates[`games/${roomId}/discard`] = cardValue;
    logAction(`⚡ Défausse rapide réussie : carte ${cardValue} défaussée${targetName === username ? "" : " depuis la main de " + targetName} !`);
    if (targetIndex !== playerIndex) {
      // If discarding from an opponent's hand, give them one card from my hand as penalty
      const myName = username;
      const myHand = [...(playersData[myName]?.hand || [])];
      if (myHand.length > 0) {
        // Choose highest value card from my hand to give to opponent
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
        targetHand.push(cardToGive);
        updates[`games/${roomId}/players/${targetName}/hand`] = targetHand;
        updates[`games/${roomId}/players/${myName}/hand`] = myHand;
        logAction(`🔁 Vous donnez votre carte ${cardToGive} à ${targetName}.`);
      }
    }
    update(ref(db), updates);
  } else {
    // Quick discard failed: draw a penalty card for yourself
    const myName = username;
    const myHand = [...(playersData[myName]?.hand || [])];
    const pool = ["R","A",2,3,4,5,6,7,8,9,10,"V","D"];
    const penaltyCard = pool[Math.floor(Math.random() * pool.length)];
    myHand.push(penaltyCard);
    set(ref(db, `games/${roomId}/players/${myName}/hand`), myHand);
    logAction(`❌ Défausse rapide ratée ! Vous piochez une carte de pénalité (${penaltyCard}).`);
  }
}

// Check if a discarded card triggers a special effect. Returns true if special action triggered.
function handleSpecialCard(card) {
  // Card values that trigger effects: "8", "10", "V" (Valet)
  // (Roi = 0 points, As = 1, 2 = -2, Dame = 10 but no special)
  specialAction = false;
  pendingSpecial = null;
  if (card === 8) {
    specialAction = true;
    pendingSpecial = 8;
    // Allow player to look at one of their cards
    document.getElementById("skip-special").style.display = "inline-block";
    logAction("👁 Effet spécial : regardez une de vos cartes.");
    return true;
  }
  if (card === 10) {
    specialAction = true;
    pendingSpecial = 10;
    // Allow player to look at an opponent's card
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

// End the current player's turn and move to the next player (unless Cactus declared triggers round end)
function endTurnProcedure() {
  if (specialAction) {
    // If a special action is still pending (shouldn't call endTurn until resolved)
    return;
  }
  if (cactusDeclared) {
    const nextIdx = (currentPlayerIndex % playerCount) + 1;
    if (nextIdx === cactusPlayerIndex) {
      // Reached the player who called Cactus: end the round
      set(ref(db, `games/${roomId}/state`), "ended");
      return;
    }
  }
  // Move turn to next player
  const nextIndex = currentPlayerIndex ? (currentPlayerIndex % playerCount) + 1 : 1;
  set(ref(db, `games/${roomId}/currentPlayer`), nextIndex);
}

// “Skip special” action: cancel or finish any special effect and end turn
function skipSpecial() {
  specialAction = false;
  pendingSpecial = null;
  selectedForSwap = null;
  // Hide the skip button if present
  const skipBtn = document.getElementById("skip-special");
  if (skipBtn) skipBtn.style.display = "none";
  logAction("⏭ Action spéciale terminée");
  endTurnProcedure();
}

// Handle drawing a new card from the deck
function drawCard() {
  if (currentPlayerIndex !== playerIndex) {
    return logAction("⛔ Ce n'est pas votre tour de jouer !");
  }
  if (drawnCard !== null) {
    return logAction("⏳ Vous avez déjà une carte piochée en attente.");
  }
  // Draw a random card from the pool (simulate infinite deck)
  const pool = ["R","A",2,3,4,5,6,7,8,9,10,"V","D"];
  drawnCard = pool[Math.floor(Math.random() * pool.length)];
  logAction("🃏 Carte piochée : " + drawnCard);
  // Show the drawn card in UI (for the drawing player)
  const newCardSpan = document.getElementById("new-card");
  const drawnCardP = document.getElementById("drawn-card");
  if (newCardSpan && drawnCardP) {
    newCardSpan.innerText = drawnCard;
    drawnCardP.style.display = "block";  // reveal the "Carte piochée" message
  }
}

// Handle taking the top card from the discard pile
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
  // Take the discard card as the drawn card
  drawnCard = currentDiscard;
  // Remove it from the discard pile in DB (now discard becomes empty)
  set(ref(db, `games/${roomId}/discard`), null);
  logAction("🔁 Carte récupérée de la défausse : " + drawnCard);
  // Show it to the player as a drawn card
  const newCardSpan = document.getElementById("new-card");
  const drawnCardP = document.getElementById("drawn-card");
  if (newCardSpan && drawnCardP) {
    newCardSpan.innerText = drawnCard;
    drawnCardP.style.display = "block";
  }
}

// Handle discarding the currently drawn card (player decides not to swap it)
function discardDrawnCard() {
  if (drawnCard === null) return;
  // Move drawn card to discard pile
  const card = drawnCard;
  drawnCard = null;
  set(ref(db, `games/${roomId}/discard`), card);
  logAction("🗑 Carte défaussée : " + card);
  // Check for special effect on the discarded card
  const hadSpecial = handleSpecialCard(card);
  // Hide the drawn card display
  const drawnCardP = document.getElementById("drawn-card");
  if (drawnCardP) drawnCardP.style.display = "none";
  // If no special action triggered, end turn immediately
  if (!hadSpecial) {
    endTurnProcedure();
  }
}

// Handle discarding a card from the hand during a turn (quick discard action)
function discardFromHand(playerIdx, cardIdx) {
  // Only allow the current player to discard their own card
  if (playerIdx !== currentPlayerIndex) {
    return logAction("⛔ Ce n'est pas le tour de ce joueur !");
  }
  if (playerIdx !== playerIndex) {
    return logAction("⛔ Vous ne pouvez pas défausser la carte d'un autre joueur !");
  }
  if (drawnCard !== null) {
    return logAction("⏳ Vous devez d'abord jouer ou défausser la carte piochée !");
  }
  const name = playersByIndex[playerIdx];
  const handArr = [...(playersData[name]?.hand || [])];
  if (cardIdx < 0 || cardIdx >= handArr.length) return;
  const card = handArr[cardIdx];
  const top = currentDiscard;
  let message = "";
  if (top !== null && card === top) {
    // Valid discard: remove card from hand
    handArr.splice(cardIdx, 1);
    message = "✅ Carte défaussée : " + card;
  } else {
    // Invalid discard: replace card with a new random card (penalty)
    const pool = ["R","A",2,3,4,5,6,7,8,9,10,"V","D"];
    const newCard = pool[Math.floor(Math.random() * pool.length)];
    handArr[cardIdx] = newCard;
    message = "❌ Mauvaise défausse. Pénalité !";
  }
  // Update hand and discard in DB
  const updates = {};
  updates[`games/${roomId}/players/${name}/hand`] = handArr;
  updates[`games/${roomId}/discard`] = card;
  update(ref(db), updates);
  // Log action locally
  logAction(message);
  // Check for special effect on discarded card
  const hadSpecial = handleSpecialCard(card);
  // End turn if no special effect
  if (!hadSpecial) {
    endTurnProcedure();
  }
}

// Declare "Cactus" (end of round call)
function declareCactus() {
  if (cactusDeclared) return;  // already declared
  cactusDeclared = true;
  cactusPlayerIndex = currentPlayerIndex;
  logAction("🌵 Joueur " + currentPlayerIndex + " dit Cactus !");
  // End turn immediately after declaring
  endTurnProcedure();
}

// Reveal final scores and determine round winner
function revealFinalScores() {
  // Compute scores (sum of card values) for each player
  const sumHand = (cards) => cards.reduce((total, c) => total + getCardValue(c), 0);
  let totals = {};
  for (let name in playersData) {
    const hand = playersData[name].hand || [];
    totals[name] = sumHand(hand);
    logAction("🧮 " + name + " : " + totals[name]);
    // Check for Royal Cactus (all cards 'R')
    if (hand.length > 0 && hand.every(c => c === "R")) {
      logAction("👑 " + name + " a un Cactus Royal !");
    }
  }
  // Determine round winner (if any player has total <= 5, lowest total wins; tie if equal)
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
        winnerName = null;  // tie for lowest
      }
    }
  }
  if (!success) {
    logAction("❌ Aucun joueur n’a réussi le Cactus.");
  } else if (!winnerName) {
    logAction("🤝 Égalité ! Pas de gagnant pour cette manche.");
  } else {
    logAction("🏆 " + winnerName + " remporte la manche !");
    // Increment the winner's score count
    const newScore = (playersData[winnerName].score || 0) + 1;
    set(ref(db, `games/${roomId}/players/${winnerName}/score`), newScore);
    // Check if game won
    if (newScore >= targetScore) {
      logAction("🎉 " + winnerName + " remporte la partie !");
      // Show reset-game button (all players)
      document.getElementById("btn-reset-game").style.display = "inline-block";
      document.getElementById("btn-new-round").style.display = "none";
    }
  }
  // Broadcast round result message for all players
  let resultMsg;
  if (!success) {
    resultMsg = "❌ Aucun joueur n’a réussi le Cactus.";
  } else if (!winnerName) {
    resultMsg = "🤝 Égalité ! Pas de gagnant pour cette manche.";
  } else {
    resultMsg = "🏆 " + winnerName + " remporte la manche !";
  }
  set(ref(db, `games/${roomId}/resultMessage`), resultMsg);
  // Round finished – allow new round if game not over
  if (isHost) {
    cactusDeclared = false;
    cactusPlayerIndex = null;
    if (document.getElementById("btn-new-round")) {
      document.getElementById("btn-new-round").style.display = "inline-block";
    }
  }
}

// Helper to get numeric value of a card for scoring
function getCardValue(card) {
  if (card === "R") return 0;
  if (card === "A") return 1;
  if (card === 2) return -2;
  if (card === "V" || card === "D" || card === 10) return 10;
  if (typeof card === "number") return card;
  return 10;
}

// Reset game back to lobby (for simplicity, just refresh page or reset UI)
function resetGame() {
  // (In a full implementation, we might clear database room state. Here we reset UI.)
  document.getElementById("config").style.display = "block";
  document.getElementById("game").style.display = "none";
  document.getElementById("btn-reset-game").style.display = "none";
  document.getElementById("log").innerHTML = "";
  // Reset local variables
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

// ***** Firebase Realtime Database Synchronization *****

// Watch for changes in the current player's turn
function watchTurn() {
  const turnRef = ref(db, `games/${roomId}/currentPlayer`);
  onValue(turnRef, (snapshot) => {
    const turn = snapshot.val();
    if (turn === null) return;
    currentPlayerIndex = turn;
    // Update turn indicator
    const turnInfo = document.getElementById("turn-info");
    if (turnInfo) {
      const name = playersByIndex[turn] || `Joueur ${turn}`;
      turnInfo.innerText = "Tour de " + name;
    }
    // Enable/disable action buttons based on whose turn it is
    const isMyTurn = (turn === playerIndex);
    document.getElementById("btn-draw-card").disabled = !isMyTurn;
    document.getElementById("btn-discard-swap").disabled = !isMyTurn;
    document.getElementById("btn-declare-cactus").disabled = !isMyTurn;
    // Log turn change
    logAction("🔄 Tour du joueur " + turn);
  });
}

// Watch for changes in the players list (connections, hands, scores)
function watchPlayers() {
  const playersRef = ref(db, `games/${roomId}/players`);
  onValue(playersRef, (snapshot) => {
    const data = snapshot.val();
    if (!data) return;
    playersData = data;
    // Rebuild index mapping and player count
    playersByIndex = {};
    playerCount = 0;
    for (let name in data) {
      const pIndex = data[name].index;
      if (pIndex) {
        playersByIndex[pIndex] = name;
        playerCount++;
      }
    }
    // Set this player's index if not already known
    if (!playerIndex && username && data[username] && data[username].index) {
      playerIndex = data[username].index;
    }
    // Update lobby or game UI depending on state
    if (!gameStarted) {
      // Lobby: update player list
      const listElem = document.getElementById("lobby-players");
      if (listElem) {
        const names = Object.keys(data);
        if (names.length > 0) {
          listElem.innerHTML = "<ul>" + names.map(n => `<li>${n}${data[n].index === 1 ? " (hôte)" : ""}</li>`).join("") + "</ul>";
        }
      }
      // Show start button to host if at least 2 players
      const startBtn = document.getElementById("start-game");
      if (startBtn) {
        startBtn.style.display = (isHost && Object.keys(data).length >= 2) ? "inline-block" : "none";
      }
    } else {
      // In-game: update scoreboard and re-render hands
      updateScoreboard();
      renderGameArea();
    }
  });
}

// Watch the game state (to transition from lobby -> setup -> playing -> ended)
function watchGameState() {
  const stateRef = ref(db, `games/${roomId}/state`);
  onValue(stateRef, (snapshot) => {
    const state = snapshot.val();
    if (!state) return;
    if (state === "setup") {
      // Move from lobby to setup screen for all players
      document.getElementById("lobby").style.display = "none";
      document.getElementById("setup").style.display = "block";
      logAction("🟢 Configuration de la partie en cours...");
    } else if (state === "playing") {
      // Start the game (or a new round) for all players
      document.getElementById("lobby").style.display = "none";
      document.getElementById("setup").style.display = "none";
      document.getElementById("game").style.display = "block";
      gameStarted = true;
      // Reset round-specific flags
      cactusDeclared = false;
      cactusPlayerIndex = null;
      // Initialize turn watcher and discard watcher now
      watchTurn();
      watchDiscard();
      if (!resultWatcherActive) {
        watchResult();
        resultWatcherActive = true;
      }
      // If host, they already dealt cards and set currentPlayer. If a client, game data is already in playersData via watchPlayers.
      // Render initial game state
      currentRound = (currentRound === 0 ? 1 : currentRound);
      updateScoreboard();
      renderGameArea();
      // If this player is not host, hide new round and reset buttons until needed
      if (!isHost) {
        document.getElementById("btn-new-round").style.display = "none";
        document.getElementById("btn-reset-game").style.display = "none";
      }
      // Allow each player to do initial peek of their cards
      if (playersData[username] && playersData[username].hand) {
        startInitialPeek();
      }
      logAction("🎮 La partie commence !");
    } else if (state === "ended") {
      // Round ended: trigger final scoring (host)
      if (isHost) {
        revealFinalScores();
      }
    }
  });
}

// Watch the current discard pile top card
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

// Watch for end-of-round result message
function watchResult() {
  const resRef = ref(db, `games/${roomId}/resultMessage`);
  onValue(resRef, (snapshot) => {
    const message = snapshot.val();
    const deckBtn = document.getElementById("btn-draw-card");
    const discardBtn = document.getElementById("btn-discard-swap");
    let winnerMsgElem = document.getElementById("winner-message");
    if (message) {
      // Hide draw/discard controls and show result message
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
      // Hide result message and restore draw/discard controls
      if (winnerMsgElem) {
        winnerMsgElem.style.display = "none";
      }
      if (deckBtn) deckBtn.style.display = "inline-block";
      if (discardBtn) discardBtn.style.display = "inline-block";
    }
  });
}

// Allow the player to reveal their initial cards (start of round)
function startInitialPeek() {
  // Highlight up to 'startVisibleCount' cards for this player to flip temporarily
  const myCards = document.querySelectorAll(`#game-area .card[data-player="${playerIndex}"]`);
  let revealed = 0;
  const toReveal = Math.min(startVisibleCount, myCards.length);
  if (toReveal <= 0) return;
  logAction(`👆 Sélectionnez ${toReveal} carte(s) à regarder (cartes de départ).`);
  myCards.forEach(cardEl => {
    // Only allow clicking your own cards for initial peek
    if (parseInt(cardEl.dataset.player) !== playerIndex) return;
    cardEl.classList.add("selectable-start");
    cardEl.addEventListener("click", function handleInitialClick() {
      if (revealed >= toReveal) {
        cardEl.classList.remove("selectable-start");
        cardEl.removeEventListener("click", handleInitialClick);
        return;
      }
      // Reveal the card's value
      const idx = parseInt(cardEl.dataset.index);
      const myHand = playersData[username]?.hand;
      if (!myHand) return;
      cardEl.innerText = myHand[idx];
      cardEl.classList.add("highlight");
      // Remove clickable status for this card after revealing
      cardEl.classList.remove("selectable-start");
      cardEl.removeEventListener("click", handleInitialClick);
      revealed++;
      if (revealed === toReveal) {
        logAction(`👀 Vous avez regardé vos ${toReveal} carte(s) de départ.`);
        // Hide them again after 5 seconds
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

// ***** User Interaction Handlers (Login, Create/Join, Start Game, etc.) *****

// Handle user login (pseudo entry)
function login() {
  const userInput = document.getElementById("username");
  const name = userInput.value.trim();
  if (!name) {
    alert("Veuillez entrer un pseudo.");
    return;
  }
  username = name;
  sessionStorage.setItem("username", username);
  // Proceed to room selection
  document.getElementById("welcome").style.display = "none";
  document.getElementById("config").style.display = "block";
  if (document.getElementById("player-name")) {
    document.getElementById("player-name").innerText = username;
  }
  logAction("👋 Bienvenue, " + username + " !");
}

// Create a new game room
async function createRoom() {
  // Generate a 6-character room code
  const code = Math.random().toString(36).substring(2, 8).toUpperCase();
  roomId = code;
  isHost = true;
  username = username || sessionStorage.getItem("username") || "Hôte";
  // Save session info
  sessionStorage.setItem("roomId", roomId);
  sessionStorage.setItem("username", username);
  sessionStorage.setItem("isHost", "true");
  // Initialize room in DB: add host player with index 1 and score 0
  await set(ref(db, `games/${roomId}/players/${username}`), { connected: true, index: 1, score: 0 });
  await set(ref(db, `games/${roomId}/host`), username);
  // Set initial turn to player 1 (host) in DB
  await set(ref(db, `games/${roomId}/currentPlayer`), 1);
  // Show lobby UI
  document.getElementById("config").style.display = "none";
  document.getElementById("lobby").style.display = "block";
  document.getElementById("lobby-room").innerText = roomId;
  logAction("🔧 Partie créée. Code : " + roomId);
  logAction("👤 Joueur ajouté : " + username + " (hôte)");
  // Start watching players and state
  watchPlayers();
  watchGameState();
}

// Join an existing game room
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
  // Determine next player index by counting existing players in DB
  try {
    const snapshot = await get(ref(db, `games/${roomId}/players`));
    if (!snapshot.exists()) {
      return alert("Code de partie introuvable.");
    }
    const currentPlayers = snapshot.val();
    const count = Object.keys(currentPlayers).length;
    const newIndex = count + 1;
    // Add this player to the room
    await set(ref(db, `games/${roomId}/players/${username}`), { connected: true, index: newIndex, score: 0 });
  } catch (err) {
    console.error("Join room error:", err);
    return alert("Impossible de rejoindre la partie. Vérifiez le code.");
  }
  // Show lobby UI
  document.getElementById("config").style.display = "none";
  document.getElementById("lobby").style.display = "block";
  document.getElementById("lobby-room").innerText = roomId;
  logAction("🔗 Rejoint la partie : " + roomId);
  logAction("👤 Joueur ajouté : " + username);
  // Start watching players and state
  watchPlayers();
  watchGameState();
}

// Launch the game setup (host clicks "Lancer la partie" in lobby)
function launchSetup() {
  if (!isHost) return;
  set(ref(db, `games/${roomId}/state`), "setup");
  // (UI updates for setup screen are handled by watchGameState on all clients)
}

// Save game configuration (host)
function saveGameConfig() {
  if (!isHost) return;
  // Read values from inputs
  cardCount = parseInt(document.getElementById("card-count").value) || 4;
  startVisibleCount = parseInt(document.getElementById("visible-count").value) || 2;
  targetScore = parseInt(document.getElementById("target-score").value) || 3;
  logAction(`💾 Configuration : ${cardCount} cartes, ${startVisibleCount} visibles, objectif ${targetScore} manche(s) gagnante(s).`);
  // (We will store config in DB when starting the game)
}

// Start the game (host clicks "Lancer la partie" on setup screen)
function startGame() {
  if (!isHost) return;
  // Save game config to DB for reference
  const configData = { cardCount, startVisibleCount, targetScore };
  set(ref(db, `games/${roomId}/config`), configData);
  // Deal random hands to each player
  const deckValues = ["R","A",2,3,4,5,6,7,8,9,10,"V","D"];
  const updates = {};
  for (let name in playersData) {
    const hand = [];
    for (let i = 0; i < cardCount; i++) {
      hand.push(deckValues[Math.floor(Math.random() * deckValues.length)]);
    }
    updates[`games/${roomId}/players/${name}/hand`] = hand;
    // Ensure score field exists (start at 0)
    updates[`games/${roomId}/players/${name}/score`] = playersData[name].score ?? 0;
  }
  // Initialize game state: clear discard, set round 1, mark state as playing
  updates[`games/${roomId}/discard`] = null;
  updates[`games/${roomId}/round`] = 1;
  updates[`games/${roomId}/resultMessage`] = null;
  updates[`games/${roomId}/state`] = "playing";
  update(ref(db), updates);
  currentRound = 1;
  // Host specific UI setup
  gameStarted = true;
  document.getElementById("btn-new-round").style.display = "none";
  document.getElementById("btn-reset-game").style.display = "none";
  logAction("🃏 Cartes distribuées. La partie va commencer !");
}

// Start a new round (host clicks "Nouvelle manche")
function startNewRound() {
  if (!isHost) return;
  // Increment round number
  currentRound += 1;
  // Reset round-specific flags
  cactusDeclared = false;
  cactusPlayerIndex = null;
  specialAction = false;
  pendingSpecial = null;
  selectedForSwap = null;
  drawnCard = null;
  // Deal new hands for each player
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
  updates[`games/${roomId}/resultMessage`] = null;
  updates[`games/${roomId}/state`] = "playing";
  update(ref(db), updates);
  // Hide new-round button until this round ends
  document.getElementById("btn-new-round").style.display = "none";
  logAction("🔁 Nouvelle manche commencée (Manche " + currentRound + ").");
}

// Event listeners for user interface actions
document.getElementById("btn-login").addEventListener("click", login);
document.getElementById("btn-create-room").addEventListener("click", createRoom);
document.getElementById("btn-join-room").addEventListener("click", joinRoom);
document.getElementById("start-game").addEventListener("click", launchSetup);
document.getElementById("btn-save-config").addEventListener("click", saveGameConfig);
document.getElementById("btn-start-game").addEventListener("click", startGame);
document.getElementById("btn-draw-card").addEventListener("click", drawCard);
document.getElementById("btn-discard-swap").addEventListener("click", takeDiscard);
document.getElementById("skip-special").addEventListener("click", skipSpecial);
document.getElementById("drawn-card").addEventListener("click", discardDrawnCard);
document.getElementById("btn-declare-cactus").addEventListener("click", declareCactus);
document.getElementById("btn-new-round").addEventListener("click", startNewRound);
document.getElementById("btn-reset-game").addEventListener("click", resetGame);

// On page load, if user was in a room, auto-reconnect to that game
window.addEventListener("load", () => {
  const savedRoom = sessionStorage.getItem("roomId");
  const savedName = sessionStorage.getItem("username");
  const savedHost = sessionStorage.getItem("isHost");
  if (savedRoom && savedName) {
    roomId = savedRoom;
    username = savedName;
    isHost = (savedHost === "true");
    // Hide welcome/config, show appropriate screen depending on game state
    document.getElementById("welcome").style.display = "none";
    document.getElementById("config").style.display = "none";
    document.getElementById("lobby").style.display = "block";
    document.getElementById("lobby-room").innerText = roomId;
    logAction("🔗 Reconnexion à la partie " + roomId + " en cours...");
    // Watch players and game state, the callbacks will adjust UI to the correct stage
    watchPlayers();
    watchGameState();
  }
});

// Enable Create/Join buttons once Firebase is initialized
document.getElementById("btn-create-room").disabled = false;
document.getElementById("btn-join-room").disabled = false;
