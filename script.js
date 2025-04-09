// Import Firebase modules (using modular SDK)
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.5.0/firebase-app.js";
import { getDatabase, ref, set, update, onValue, get } from "https://www.gstatic.com/firebasejs/11.5.0/firebase-database.js";

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSy...Jcdv0",  // (identique à la config fournie)
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
let selectedForSwap = null;        // Used for Jack effect
let cactusDeclared = false;
let cactusPlayerIndex = null;

function startNewGame(host = false) {
  selectingInitialCards = true;
  revealedIndexes = [];
  drawnCard = null;
  discardPile = [];
  specialAction = null;
  jackSwapSelectedIndex = null;
  roundComplete = false;

  const username = sessionStorage.getItem("username");

  if (host) {
    const roomId = sessionStorage.getItem("roomId");
    const gameRef = ref(database, `games/${roomId}`);

    // Générer les cartes pour chaque joueur
    const allPlayers = players;
    const gameState = {
      startedBy: username,
      round: currentRound + 1,
      currentPlayer: allPlayers[0],
      hands: {},
      discardPile: [],
      revealed: {},
    };

    allPlayers.forEach((p) => {
      const hand = Array.from({ length: cardCount }, () =>
        CARD_POOL[Math.floor(Math.random() * CARD_POOL.length)]
      );
      gameState.hands[p] = hand;
      gameState.revealed[p] = [];
    });

    // Écrire dans Firebase → déclenche le jeu pour tout le monde
    update(gameRef, {
      gameState,
    });

    log(`🆕 Nouvelle manche lancée par ${username}`);
  }
}



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
    // Container for this player's hand
    const playerDiv = document.createElement("div");
    playerDiv.className = "player-area";
    // Player label (mark your own as "Vous")
    const label = document.createElement("h3");
    label.textContent = (name === username) ? `${name} (Vous)` : name;
    playerDiv.appendChild(label);
    // Cards
    hand.forEach((cardValue, idx) => {
      const wrapper = document.createElement("div");
      wrapper.className = "card-wrapper";
      const cardEl = document.createElement("div");
      cardEl.className = "card";
      // Face-down card for all players (unless temporarily revealed)
      cardEl.innerText = "?";
      // Data attributes for context
      cardEl.dataset.player = String(playersData[name].index);
      cardEl.dataset.index = String(idx);
      // Card click: handle swap/special (in turn)
      cardEl.addEventListener("click", onCardClick);
      // Quick discard button
      const quickBtn = document.createElement("button");
      quickBtn.innerText = "⚡";
      quickBtn.className = "quick-discard-btn";
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

// Handler for clicking a card (swap on your turn, special reveals, etc.)
function onCardClick(event) {
  const cardEl = event.currentTarget;
  const player = parseInt(cardEl.dataset.player);
  const index = parseInt(cardEl.dataset.index);
  if (isNaN(player) || isNaN(index) || !playersData) return;
  const name = playersByIndex[player];
  const handArray = playersData[name]?.hand;
  if (!handArray) return;

  // Special action in progress (8 = peek own, 10 = peek opponent, V = swap)
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
    // Valet: swap one of your cards with an opponent's
    if (!selectedForSwap && player === currentPlayerIndex) {
      // First click: select your card to swap
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
      // Swap values
      const temp = myHand[myIndex];
      myHand[myIndex] = oppHand[index];
      oppHand[index] = temp;
      // Update both hands in DB
      const updates = {};
      updates[`games/${roomId}/players/${myName}/hand`] = myHand;
      updates[`games/${roomId}/players/${opponentName}/hand`] = oppHand;
      update(ref(db), updates);
      selectedForSwap = null;
      logAction("🔄 Cartes échangées entre " + myName + " et " + opponentName);
      // End special effect/turn
      skipSpecial();
      return;
    }
  }

  // Normal card click during your turn (swap drawn card)
  if (player !== currentPlayerIndex || drawnCard === null) {
    // Ignore clicks if not your turn or nothing to swap
    return;
  }
  // Swap drawnCard with one of your cards
  const currentName = playersByIndex[currentPlayerIndex];
  const handArr = playersData[currentName]?.hand;
  if (!handArr) return;
  const replaced = handArr[index];
  // Put drawn card in hand, send replaced card to discard
  handArr[index] = drawnCard;
  const oldCard = replaced;
  const newCard = drawnCard;
  drawnCard = null;
  // Update hand and discard in DB
  set(ref(db, `games/${roomId}/players/${currentName}/hand`), handArr);
  set(ref(db, `games/${roomId}/discard`), oldCard);
  // Hide drawn card UI and log swap
  document.getElementById("drawn-card").style.display = "none";
  logAction(`🔄 Carte échangée : ${oldCard} ↔ ${newCard}`);
  // Check for special effect on discarded card
  handleSpecialCard(oldCard);
}

// Check if a discarded card triggers a special effect
function handleSpecialCard(card) {
  // Special cards: 8, 10, V (Valet)
  specialAction = false;
  pendingSpecial = null;
  if (card === 8) {
    specialAction = true;
    pendingSpecial = 8;
    document.getElementById("skip-special").style.display = "inline-block";
    logAction("👁 Effet spécial : regardez une de vos cartes.");
    return true;
  }
  if (card === 10) {
    specialAction = true;
    pendingSpecial = 10;
    document.getElementById("skip-special").style.display = "inline-block";
    logAction("🔍 Effet spécial : regardez une carte d'un adversaire.");
    return true;
  }
  if (card === "V") {
    specialAction = true;
    pendingSpecial = "V";
    document.getElementById("skip-special").style.display = "inline-block";
    logAction("🔄 Effet spécial : échangez une de vos cartes avec un adversaire.");
    return true;
  }
  return false;
}

// End the current player's turn and move to the next player (unless Cactus triggers end)
function endTurnProcedure() {
  if (specialAction) return;
  if (cactusDeclared && currentPlayerIndex !== cactusPlayerIndex) {
    // Cactus declared: wait for others to finish
    return;
  }
  // Next player's turn
  const nextIndex = currentPlayerIndex ? (currentPlayerIndex % playerCount) + 1 : 1;
  set(ref(db, `games/${roomId}/currentPlayer`), nextIndex);
}

// Skip special action: cancel any pending special effect and end turn
function skipSpecial() {
  specialAction = false;
  pendingSpecial = null;
  selectedForSwap = null;
  document.getElementById("skip-special").style.display = "none";
  logAction("⏭ Action spéciale terminée");
  endTurnProcedure();
}

// Attempt a quick discard of a card (out of turn)
function attemptQuickDiscard(targetPlayerIndex, cardIdx) {
  // Only proceed if it's not your turn
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
  const normalize = (val) => (typeof val === "number" ? val : isNaN(val) ? val : parseInt(val));
  if (normalize(cardValue) === normalize(currentDiscard)) {
    // Quick discard success: remove the card and update discard
    targetHand.splice(cardIdx, 1);
    const updates = {};
    updates[`games/${roomId}/players/${targetName}/hand`] = targetHand;
    updates[`games/${roomId}/discard`] = cardValue;
    logAction(`⚡ Défausse rapide réussie : carte ${cardValue} défaussée${targetName === username ? "" : " depuis la main de " + targetName} !`);
    if (targetPlayerIndex !== playerIndex) {
      // If discarding from an opponent's hand, give them one card from my hand
      const myName = username;
      const myHand = [...playersData[myName].hand];
      if (myHand.length > 0) {
        // Choose highest value card to give
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
    // Quick discard failed: draw a penalty card
    const myName = username;
    const myHand = [...(playersData[myName]?.hand || [])];
    const pool = ["R","A",2,3,4,5,6,7,8,9,10,"V","D"];
    const penaltyCard = pool[Math.floor(Math.random() * pool.length)];
    myHand.push(penaltyCard);
    set(ref(db, `games/${roomId}/players/${myName}/hand`), myHand);
    logAction(`❌ Défausse rapide ratée ! Vous piochez une carte de pénalité (${penaltyCard}).`);
  }
}

// Draw a new card from the deck
function drawCard() {
  if (currentPlayerIndex !== playerIndex) {
    return logAction("⛔ Ce n'est pas votre tour de jouer !");
  }
  if (drawnCard !== null) {
    return logAction("⏳ Vous avez déjà une carte piochée en attente.");
  }
  // Draw random card (infinite deck simulation)
  const pool = ["R","A",2,3,4,5,6,7,8,9,10,"V","D"];
  drawnCard = pool[Math.floor(Math.random() * pool.length)];
  logAction("🃏 Carte piochée : " + drawnCard);
  // Show drawn card to this player
  document.getElementById("new-card").innerText = drawnCard;
  document.getElementById("drawn-card").style.display = "block";
}

// Take the top card from the discard pile
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
  // Take discard card as drawn card
  drawnCard = currentDiscard;
  // Remove it from discard pile in DB
  set(ref(db, `games/${roomId}/discard`), null);
  logAction("🔁 Carte récupérée de la défausse : " + drawnCard);
  // Show it as drawn card
  document.getElementById("new-card").innerText = drawnCard;
  document.getElementById("drawn-card").style.display = "block";
}

// Discard the currently drawn card (without swapping)
function discardDrawnCard() {
  if (drawnCard === null) return;
  const card = drawnCard;
  drawnCard = null;
  set(ref(db, `games/${roomId}/discard`), card);
  logAction("🗑 Carte défaussée : " + card);
  const hadSpecial = handleSpecialCard(card);
  document.getElementById("drawn-card").style.display = "none";
  if (!hadSpecial) {
    endTurnProcedure();
  }
}

// Declare "Cactus" (end of round)
function declareCactus() {
  if (cactusDeclared) return;
  cactusDeclared = true;
  cactusPlayerIndex = currentPlayerIndex;
  logAction("🌵 Joueur " + currentPlayerIndex + " dit Cactus !");
  endTurnProcedure();
}

// Reveal final scores and determine round winner (host only)
function revealFinalScores() {
  // Sum of card values for each player
  const sumHand = (cards) => cards.reduce((total, c) => total + getCardValue(c), 0);
  let totals = {};
  for (let name in playersData) {
    const hand = playersData[name].hand || [];
    totals[name] = sumHand(hand);
    logAction("🧮 " + name + " : " + totals[name]);
    if (hand.length > 0 && hand.every(c => c === "R")) {
      logAction("👑 " + name + " a un Cactus Royal !");
    }
  }
  // Determine round winner (if any total <= 5, lowest wins; tie = no winner)
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
  if (!success) {
    logAction("❌ Aucun joueur n’a réussi le Cactus.");
  } else if (!winnerName) {
    logAction("🤝 Égalité ! Pas de gagnant pour cette manche.");
  } else {
    logAction("🏆 " + winnerName + " remporte la manche !");
    const newScore = (playersData[winnerName].score || 0) + 1;
    set(ref(db, `games/${roomId}/players/${winnerName}/score`), newScore);
    if (newScore >= targetScore) {
      logAction("🎉 " + winnerName + " remporte la partie !");
      document.getElementById("btn-reset-game").style.display = "inline-block";
      document.getElementById("btn-new-round").style.display = "none";
    }
  }
  // Round finished – allow new round if game not over
  if (isHost) {
    cactusDeclared = false;
    cactusPlayerIndex = null;
    document.getElementById("btn-new-round").style.display = "inline-block";
  }
}

// Helper to get numeric value of a card (for scoring)
function getCardValue(card) {
  if (card === "R") return 0;
  if (card === "A") return 1;
  if (card === 2) return -2;
  if (card === "V" || card === "D" || card === 10) return 10;
  if (typeof card === "number") return card;
  return 10;
}

// Reset game back to lobby
function resetGame() {
  if (!isHost) return;
  // Notify all players (set state to lobby)
  const updates = {};
  updates[`games/${roomId}/state`] = "lobby";
  updates[`games/${roomId}/currentPlayer`] = null;
  update(ref(db), updates);
  // Switch host UI to lobby
  document.getElementById("lobby").style.display = "block";
  document.getElementById("config").style.display = "none";
  document.getElementById("setup").style.display = "none";
  document.getElementById("game").style.display = "none";
  document.getElementById("btn-reset-game").style.display = "none";
  document.getElementById("btn-new-round").style.display = "none";
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
  logAction("🔁 Partie terminée.");
}

// ***** Firebase Realtime Database Synchronization *****

// Watch the current player's turn
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
    // If Cactus was declared and we've moved to next player, host triggers final scoring
    if (cactusDeclared && turn !== cactusPlayerIndex && isHost) {
      revealFinalScores();
    }
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
    // Set this player's index if known
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
      // In-game: update scoreboard and render hands
      updateScoreboard();
      renderGameArea();
      // If host, check for any empty hand (round win)
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

function watchGameState() {
  const gameRef = ref(db, `games/${roomCode}`);
  onValue(gameRef, (snapshot) => {
    const data = snapshot.val();
    if (!data) return;

    gameState = data;
    players = Object.keys(data.players || {});
    playersData = data.players || {};
    currentPlayer = data.currentTurn;
    discardPile = data.discardPile || [];
    drawnCard = data.drawnCard || null;
    targetScore = data.targetScore || 3;
    startVisibleCount = data.visibleCount || 2;
    cardCount = data.cardCount || 4;
    state = data.state;
    roundComplete = data.roundComplete || false;
    currentRound = data.round || 1;

    if (state === "lobby") {
      document.getElementById("welcome").style.display = "none";
      document.getElementById("config").style.display = "none";
      document.getElementById("lobby").style.display = "block";
      document.getElementById("lobby-room").innerText = roomCode;
      updateLobbyPlayers();
    } else if (state === "setup") {
      document.getElementById("lobby").style.display = "none";
      document.getElementById("setup").style.display = "block";
    } else if (state === "playing") {
      document.getElementById("lobby").style.display = "none";
      document.getElementById("setup").style.display = "none";
      document.getElementById("game").style.display = "block";
      gameStarted = true;
      watchTurn();
      watchDiscard();
      updateScoreboard();
      renderGameArea();

      if (!isHost) {
        document.getElementById("btn-new-round").style.display = "none";
        document.getElementById("btn-reset-game").style.display = "none";
      }

      const me = username;
      if (
        playersData[me] &&
        playersData[me].hand &&
        playersData[me].peekDone !== true
      ) {
        startInitialPeek();
      }

      logAction("🎮 La partie commence !");
    }
  });
}

// Watch the current discard pile
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

function startInitialPeek() {
  const myCards = document.querySelectorAll(`#game-area .card[data-player="${playerIndex}"]`);
  let revealed = 0;
  const toReveal = Math.min(startVisibleCount, myCards.length);
  if (toReveal <= 0) return;
  logAction(`👆 Sélectionnez ${toReveal} carte(s) à regarder (cartes de départ).`);

  myCards.forEach((cardEl, idx) => {
    if (parseInt(cardEl.dataset.player) !== playerIndex) return;
    cardEl.classList.add("selectable-start");

    const handler = () => {
      if (revealed >= toReveal) return;
      const index = parseInt(cardEl.dataset.index);
      const myHand = playersData[username]?.hand;
      if (!myHand) return;
      cardEl.innerText = myHand[index];
      cardEl.classList.add("highlight");
      revealed++;

      if (revealed === toReveal) {
        logAction(`👀 Vous avez regardé vos ${toReveal} carte(s) de départ.`);
        set(ref(db, `games/${roomId}/players/${username}/peekDone`), true);

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

// ***** User Interaction Handlers (Login, Create/Join, Start Game, etc.) *****

function login() {
  const userInput = document.getElementById("username");
  const name = userInput.value.trim();
  if (!name) {
    alert("Veuillez entrer un pseudo.");
    return;
  }
  username = name;
  sessionStorage.setItem("username", username);
  // Go to room selection
  document.getElementById("welcome").style.display = "none";
  document.getElementById("config").style.display = "block";
  if (document.getElementById("player-name")) {
  document.getElementById("player-name").innerText = username;
}
  logAction("👋 Bienvenue, " + username + " !");
}

async function createRoom() {
  // Generate a 6-character room code
  const code = Math.random().toString(36).substring(2, 8).toUpperCase();
  roomId = code;
  isHost = true;
  username = username || sessionStorage.getItem("username") || "Hôte";
  sessionStorage.setItem("roomId", roomId);
  sessionStorage.setItem("username", username);
  sessionStorage.setItem("isHost", "true");
  // Initialize room in DB (host player index 1)
  await set(ref(db, `games/${roomId}/players/${username}`), { connected: true, index: 1, score: 0 });
  await set(ref(db, `games/${roomId}/host`), username);
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
  try {
    const snapshot = await get(ref(db, `games/${roomId}/players`));
    if (!snapshot.exists()) {
      return alert("Code de partie introuvable.");
    }
    const currentPlayers = snapshot.val();
    const count = Object.keys(currentPlayers).length;
    const newIndex = count + 1;
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
  // Start watchers
  watchPlayers();
  watchGameState();
}

function launchSetup() {
  if (!isHost) return;
  set(ref(db, `games/${roomId}/state`), "setup");
}

function saveGameConfig() {
  if (!isHost) return;
  // Read config inputs
  cardCount = parseInt(document.getElementById("card-count").value) || 4;
  startVisibleCount = parseInt(document.getElementById("visible-count").value) || 2;
  targetScore = parseInt(document.getElementById("target-score").value) || 3;
  logAction(`💾 Configuration : ${cardCount} cartes, ${startVisibleCount} visibles, objectif ${targetScore} manche(s).`);
  // (Config will be saved to DB on game start)
}

function startGame() {
  if (!isHost) return;
  // Save config to DB
  const configData = { cardCount, startVisibleCount, targetScore };
  set(ref(db, `games/${roomId}/config`), configData);
  // Deal random hands
  const deckValues = ["R","A",2,3,4,5,6,7,8,9,10,"V","D"];
  const updates = {};
  for (let name in playersData) {
    const hand = [];
    for (let i = 0; i < cardCount; i++) {
      hand.push(deckValues[Math.floor(Math.random() * deckValues.length)]);
    }
    updates[`games/${roomId}/players/${name}/hand`] = hand;
    updates[`games/${roomId}/players/${name}/score`] = playersData[name].score ?? 0;
    updates[`games/${roomId}/players/${name}/peekDone`] = false;
  }
  // Initialize round 1
  updates[`games/${roomId}/discard`] = null;
  updates[`games/${roomId}/round`] = 1;
  updates[`games/${roomId}/state`] = "playing";
  update(ref(db), updates);
  currentRound = 1;
  gameStarted = true;
  document.getElementById("btn-new-round").style.display = "none";
  document.getElementById("btn-reset-game").style.display = "none";
  logAction("🃏 Cartes distribuées. La partie va commencer !");
}

function startNewRound() {
  if (!isHost) return;
  currentRound += 1;
  // Reset round flags
  cactusDeclared = false;
  cactusPlayerIndex = null;
  specialAction = false;
  pendingSpecial = null;
  selectedForSwap = null;
  drawnCard = null;
  // Deal new hands
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
  updates[`games/${roomId}/currentPlayer`] = 1;
  update(ref(db), updates);
  document.getElementById("btn-new-round").style.display = "none";
  logAction("🔁 Nouvelle manche commencée (Manche " + currentRound + ").");
}

// Event listeners
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

// Auto-reconnect to game if page reloaded
window.addEventListener("load", () => {
  const savedRoom = sessionStorage.getItem("roomId");
  const savedName = sessionStorage.getItem("username");
  const savedHost = sessionStorage.getItem("isHost");
  if (savedRoom && savedName) {
    roomId = savedRoom;
    username = savedName;
    isHost = (savedHost === "true");
    // Show lobby (we will adjust to correct stage via watchers)
    document.getElementById("welcome").style.display = "none";
    document.getElementById("config").style.display = "none";
    document.getElementById("lobby").style.display = "block";
    document.getElementById("lobby-room").innerText = roomId;
    logAction("🔗 Reconnexion à la partie " + roomId + " en cours...");
    // Start watchers (they will update UI accordingly)
    watchPlayers();
    watchGameState();
  }
});

// Enable create/join buttons once Firebase is initialized
document.getElementById("btn-create-room").disabled = false;
document.getElementById("btn-join-room").disabled = false;
