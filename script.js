// ✅ script.js avec logique corrigée : affichage mémoire, clic limité, interactions actives
let playerCards = [], botCards = [], discardPile = [], drawnCard = null;
let targetScore = 3;
let specialAction = null;
let jackSwapSelectedIndex = null;
let startVisibleCount = 2, cardCount = 4, currentPlayer = "Toi", revealedIndexes = [];
let mustGiveCardAfterEffect = false;
let pendingBotCardIndex = null;
let playerPoints = 0, botPoints = 0;
let selectingInitialCards = false;

const CARD_POOL = ["R", "A", 2, 3, 4, 5, 6, 7, 8, 9, 10, "V", "D"];
const log = (msg) => {
  document.getElementById("log").innerHTML += `<p>${msg}</p>`;
  console.log(msg);
};

function login() {
  const username = document.getElementById("username").value.trim();
  if (!username) return alert("Entre un pseudo pour continuer.");
  sessionStorage.setItem("username", username);
  document.getElementById("welcome").style.display = "none";
  document.getElementById("config").style.display = "block";
  document.getElementById("player-name").innerText = username;
  log(`👋 Bienvenue, ${username} !`);
}

function safeCreateRoom() {
  log("🧪 Création fictive d'une partie...");
  document.getElementById("config").style.display = "none";
  document.getElementById("lobby").style.display = "block";
  document.getElementById("lobby-room").innerText = "TEST123";
  document.getElementById("lobby-players").innerHTML = `<li>Toi (hôte)</li><li>Bot</li>`;
  document.getElementById("btn-launch-setup").style.display = "inline-block";
}

function joinRoom() {
  log("🧪 Rejoint fictivement une partie...");
  document.getElementById("config").style.display = "none";
  document.getElementById("lobby").style.display = "block";
  document.getElementById("lobby-room").innerText = "TEST123";
  document.getElementById("lobby-players").innerHTML = "<li>Bot (hôte)</li><li>Toi</li>";
  setTimeout(() => {
    log("🚦 Le bot lance la configuration de la partie...");
    launchSetup();
  }, 2000);
}

function launchSetup() {
  document.getElementById("lobby").style.display = "none";
  document.getElementById("setup").style.display = "block";
}

function saveGameConfig() {
  startVisibleCount = parseInt(document.getElementById("visible-count").value);
  cardCount = parseInt(document.getElementById("card-count").value);
  targetScore = parseInt(document.getElementById("target-score").value);
  log(`💾 Config sauvegardée (Cartes: ${cardCount}, Visibles: ${startVisibleCount}, Cible: ${targetScore})`);
}

function startNewGame() {
  document.getElementById("setup").style.display = "none";
  document.getElementById("game").style.display = "block";
  playerCards = Array.from({ length: cardCount }, () => CARD_POOL[Math.floor(Math.random() * CARD_POOL.length)]);
  botCards = Array.from({ length: cardCount }, () => CARD_POOL[Math.floor(Math.random() * CARD_POOL.length)]);
  discardPile = [];
  revealedIndexes = [];
  selectingInitialCards = true;
  drawnCard = null;
  specialAction = null;
  jackSwapSelectedIndex = null;
  document.getElementById("skip-special").style.display = "none";
  currentPlayer = "Toi";
  log(`🃏 Sélectionne ${startVisibleCount} carte(s) à regarder.`);
  renderCards();
  updateTurn();
}

function drawCard() {
  if (selectingInitialCards) return log("⏳ Termine d'abord ta sélection de cartes mémoire.");
  if (currentPlayer !== "Toi") return log("⛔ Ce n'est pas ton tour !");
  drawnCard = CARD_POOL[Math.floor(Math.random() * CARD_POOL.length)];
  log(`🃏 Carte piochée : ${drawnCard}`);
  showDrawnCard();
}

function showDrawnCard() {
  const drawnDiv = document.getElementById("drawn-card");
  drawnDiv.style.display = "block";
  document.getElementById("new-card").innerText = drawnCard;
  if (!document.getElementById("discard-drawn")) {
    const btn = document.createElement("button");
    btn.id = "discard-drawn";
    btn.innerText = "Défausser la carte";
    btn.onclick = discardDrawnCard;
    drawnDiv.after(btn);
  }
}

function discardDrawnCard() {
  if (drawnCard === null) return;
  discardPile.push(drawnCard);
  log(`🗑 Carte piochée défaussée : ${drawnCard}`);
  checkSpecialEffect(drawnCard);
  if (!specialAction) endPlayerTurn();
  drawnCard = null;
  document.getElementById("drawn-card").style.display = "none";
  document.getElementById("discard-drawn")?.remove();
  renderCards();
}

function attemptCardSwap(index) {
  if (drawnCard === null) return;
  const oldCard = playerCards[index];
  playerCards[index] = drawnCard;
  drawnCard = null;
  discardPile.push(oldCard);
  log(`🔄 Carte échangée : ${oldCard} → ${playerCards[index]}`);
  checkSpecialEffect(oldCard);
  if (!specialAction) endPlayerTurn();
  document.getElementById("drawn-card").style.display = "none";
  document.getElementById("discard-drawn")?.remove();
  renderCards();
}

/* --- Correction principale de la défausse rapide --- */
function discardCardFromHand(index) {
  const card = playerCards[index];
  const topDiscard = discardPile[discardPile.length - 1];
  const normalize = (val) => (typeof val === "number" ? val : isNaN(val) ? val : parseInt(val));
  
  if (drawnCard !== null) {
    return log("⏳ Vous devez d'abord jouer ou défausser la carte piochée.");
  }
  
  // Rapid discard : si la carte cliquée est identique à la carte au sommet de la défausse
  if (topDiscard && normalize(card) === normalize(topDiscard)) {
    log(`Avant suppression, playerCards: ${playerCards.join(", ")}`);
    playerCards.splice(index, 1); // Supprime la carte de la main
    log(`Après suppression, playerCards: ${playerCards.join(", ")}`);
    discardPile.push(card);
    log(`⚡ Vous défaussez rapidement votre carte ${card} qui correspond à la défausse !`);
    checkSpecialEffect(card);
    renderCards();
    return;
  } else {
    // Sinon, défausse volontaire (remplace la carte par une nouvelle aléatoire dans ta main)
    discardPile.push(card);
    playerCards[index] = CARD_POOL[Math.floor(Math.random() * CARD_POOL.length)];
    log(`🗑 Défausse volontaire de la carte ${card}`);
    checkSpecialEffect(card);
    if (!specialAction) endPlayerTurn();
    renderCards();
  }
}


function initiateDiscardSwap() {
  if (currentPlayer !== "Toi") return log("⛔ Ce n'est pas ton tour !");
  if (discardPile.length === 0) return log("❌ Aucune carte dans la défausse");
  drawnCard = discardPile.pop();
  log(`🔁 Carte récupérée de la défausse : ${drawnCard}`);
  showDrawnCard();
}

function renderCards() {
  const handDiv = document.getElementById("player-hand");
  handDiv.innerHTML = "<h3>Ton jeu</h3>";
  
  playerCards.forEach((card, i) => {
    const wrap = document.createElement("div");
    wrap.className = "card-wrapper";
    const c = document.createElement("div");
    c.className = "card";
    
    if (selectingInitialCards) {
      c.classList.add("selectable-start");
      c.innerText = revealedIndexes.includes(i) ? card : "?";
      if (revealedIndexes.includes(i)) c.classList.add("highlight");
      c.onclick = () => {
        if (revealedIndexes.length >= startVisibleCount || revealedIndexes.includes(i)) return;
        revealedIndexes.push(i);
        renderCards();
        if (revealedIndexes.length === startVisibleCount) {
          log("👀 Cartes sélectionnées. Affichage temporaire...");
          setTimeout(() => {
            selectingInitialCards = false;
            revealedIndexes = [];
            renderCards();
            log("🕑 Cartes de nouveau cachées.");
          }, 5000);
        }
      };
    } else {
      c.innerText = "?";
      c.onclick = () => handleCardClick(i, card);
      const btn = document.createElement("button");
      btn.innerText = "🗑";
      btn.className = "discard-btn";
      btn.onclick = () => discardCardFromHand(i);
      wrap.appendChild(btn);
    }
    
    wrap.appendChild(c);
    handDiv.appendChild(wrap);
  });
  
  renderBotCards();
  
  const discardSpan = document.getElementById("discard");
  if (discardSpan) {
    const topDiscard = discardPile[discardPile.length - 1];
    discardSpan.innerText = topDiscard ?? "Vide";
  }
  
  const scoresList = document.getElementById("scores-list");
  if (scoresList) {
    scoresList.innerText = `${sessionStorage.getItem("username") || "Moi"}: ${playerPoints} - Bot: ${botPoints}`;
  }
}


function attemptBotCardPlay(index, botCard) {
  const topDiscard = discardPile[discardPile.length - 1];
  if (!topDiscard) return log("❌ Il n'y a pas de carte dans la défausse.");
  if (botCard === topDiscard) {
    log(`🎯 Bonne tentative ! Carte ${botCard} retirée du Bot. Vous lui donnez une de vos cartes.`);
    // Retirer la carte du bot
    discardPile.push(botCards[index]);
    // Donner au bot la dernière carte de la main du joueur
    if (playerCards.length > 0) {
      botCards[index] = playerCards.pop();
    } else {
      botCards[index] = CARD_POOL[Math.floor(Math.random() * CARD_POOL.length)];
    }
  } else {
    const penalty = CARD_POOL[Math.floor(Math.random() * CARD_POOL.length)];
    playerCards.push(penalty);
    log(`❌ Mauvaise tentative sur la carte de l'adversaire. Vous piochez une carte de pénalité (${penalty}).`);
  }
  renderCards();
}

function checkSpecialEffect(card) {
  if (card === 8 || card === "8") {
    log("👁️ Effet 8 activé : choisissez une de vos cartes à révéler.");
    specialAction = "revealSelf";
    document.getElementById("skip-special").style.display = "inline-block";
    renderCards();
    return;
  }
  if (card === 10 || card === "10") {
    log("🔎 Effet 10 activé : choisissez une carte de l'adversaire à regarder.");
    specialAction = "lookOpp";
    document.getElementById("skip-special").style.display = "inline-block";
    renderCards();
    return;
  }
  if (card === "V" || card === "J" || card === 11) {
    log("🔄 Effet Valet activé : échangez une de vos cartes avec une de celles de l'adversaire (à l'aveugle).");
    specialAction = "swapJack";
    jackSwapSelectedIndex = null;
    document.getElementById("skip-special").style.display = "inline-block";
    renderCards();
    return;
  }
}

function discardOpponentCard(index) {
  const card = botCards[index];
  const topDiscard = discardPile[discardPile.length - 1];
  if (!topDiscard) return log("❌ Aucune carte dans la défausse.");

  const normalize = (val) => typeof val === "number" ? val : isNaN(val) ? val : parseInt(val);
  if (normalize(card) === normalize(topDiscard)) {
    log(`🎯 Bonne défausse ! La carte ${card} correspond à la défausse.`);
    discardPile.push(card);
    // Retirer la carte de l'adversaire du jeu
    botCards.splice(index, 1);
    if (card === 8 || card === "8" || card === 10 || card === "10" || card === "V" || card === "J" || card === 11) {
      mustGiveCardAfterEffect = true;
      pendingBotCardIndex = index;
      checkSpecialEffect(card);
    } else {
      specialAction = "give";
      pendingBotCardIndex = index;
      log("🎁 Choisissez une de vos cartes à donner au bot.");
      document.getElementById("skip-special").style.display = "none";
      renderCards();
    }
    return;
  } else {
    const penalty = CARD_POOL[Math.floor(Math.random() * CARD_POOL.length)];
    playerCards.push(penalty);
    log(`❌ Mauvaise tentative. Vous piochez une pénalité (${penalty}).`);
    renderCards();
    return;
  }
}

function handleCardClick(index, card) {
  if (selectingInitialCards) return log("⏳ Termine d'abord ta sélection de cartes mémoire.");
  if (specialAction === "revealSelf") {
    if (!revealedIndexes.includes(index)) {
      revealedIndexes.push(index);
    }
    log(`👁️ Vous regardez votre carte : ${card}`);
    // Afficher temporairement la valeur de votre carte
    const cardElems = document.querySelectorAll('#player-hand .card');
    const selectedCardElem = cardElems[index];
    selectedCardElem.innerText = card;
    selectedCardElem.classList.add('highlight');
    document.getElementById("skip-special").style.display = "none";
    // Empêcher plusieurs révélations
    specialAction = "waitingReveal";
    setTimeout(() => {
      selectedCardElem.innerText = "?";
      selectedCardElem.classList.remove('highlight');
      specialAction = null;
      renderCards();
      log("🕑 Carte de nouveau cachée.");
      endPlayerTurn();
    }, 3000);
  } else if (specialAction === "swapJack") {
    jackSwapSelectedIndex = index;
    log(`🃏 Carte sélectionnée pour échange avec le bot.`);
    document.querySelectorAll('.card').forEach(card => card.classList.remove('highlight-swap'));
    renderCards();
  } else if (specialAction === "give") {
    const giveCard = playerCards[index];
    playerCards.splice(index, 1);
    botCards.splice(pendingBotCardIndex, 0, giveCard);
    log(`🎁 Vous donnez votre carte ${giveCard} au bot.`);
    specialAction = null;
    pendingBotCardIndex = null;
    renderCards();
    endPlayerTurn();
  } else if (drawnCard !== null) {
    attemptCardSwap(index);
  }
}

function updateTurn() {
  document.getElementById("turn-info").innerText = `Tour de ${currentPlayer}`;
}

function endPlayerTurn() {
  if (mustGiveCardAfterEffect) {
    mustGiveCardAfterEffect = false;
    specialAction = "give";
    log("🎁 Choisissez une de vos cartes à transférer au bot.");
    document.getElementById("skip-special").style.display = "none";
    renderCards();
    return;
  }
  if (specialAction) {
    return;
  }
  currentPlayer = "Bot";
  updateTurn();
  // Petite pause avant que le bot joue
  setTimeout(botPlayTurn, 1000);
}

function botPlayTurn() {
  // Le bot pioche une carte
  const card = CARD_POOL[Math.floor(Math.random() * CARD_POOL.length)];
  let actionLog = `🤖 Bot pioche ${card}. `;
  // Décision : garder ou défausser
  const valueMap = { "A": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, "10": 10, "V": 11, "D": 12, "R": 13 };
  const drawnValue = valueMap[card] || card;
  // Trouver la carte de plus forte valeur dans la main du bot
  let highestIndex = 0;
  let highestValue = -1;
  botCards.forEach((c, idx) => {
    const val = valueMap[c] || c;
    if (val > highestValue) {
      highestValue = val;
      highestIndex = idx;
    }
  });
  if (drawnValue < highestValue) {
    // Le bot garde la carte piochée et défausse sa plus haute carte
    const discarded = botCards[highestIndex];
    botCards[highestIndex] = card;
    discardPile.push(discarded);
    actionLog += `Il garde ${card} et défausse ${discarded}.`;
    // Effets spéciaux possibles si la carte défaussée est spéciale
    if (discarded === 8 || discarded === "8") {
      // Bot regarde une de ses cartes
      const peekIndex = Math.floor(Math.random() * botCards.length);
      log(`${actionLog} (Le bot regarde sa carte en position ${peekIndex+1}.)`);
    } else if (discarded === 10 || discarded === "10") {
      // Bot regarde une des cartes du joueur
      const peekIndex = Math.floor(Math.random() * playerCards.length);
      const peekedCard = playerCards[peekIndex];
      log(`${actionLog} (Le bot regarde votre carte en position ${peekIndex+1} : ${peekedCard}.)`);
    } else if (discarded === "V" || discarded === "J" || discarded === 11) {
      // Bot utilise l'effet du Valet : échange une carte au hasard avec le joueur
      const botIndex = Math.floor(Math.random() * botCards.length);
      const playerIndex = Math.floor(Math.random() * playerCards.length);
      const botCard = botCards[botIndex];
      const playerCard = playerCards[playerIndex];
      botCards[botIndex] = playerCard;
      playerCards[playerIndex] = botCard;
      log(`${actionLog} (Le bot a utilisé un Valet et a échangé sa carte en position ${botIndex+1} avec votre carte en position ${playerIndex+1}.)`);
      // Si la carte du joueur échangée était connue, on l'oublie maintenant
      const revIdx = revealedIndexes.indexOf(playerIndex);
      if (revIdx !== -1) {
        revealedIndexes.splice(revIdx, 1);
      }
    } else {
      log(actionLog);
    }
  } else {
    // Le bot défausse directement la carte piochée
    discardPile.push(card);
    actionLog += `Il défausse ${card}.`;
    log(actionLog);
  }
  renderCards();
  currentPlayer = "Toi";
  updateTurn();
}

function skipSpecial() {
  if (!specialAction) return;
  log("⏭ Vous ignorez l'effet spécial en cours.");
  // Annuler l'action spéciale en cours
  specialAction = null;
  jackSwapSelectedIndex = null;
  // Cacher le bouton de passe
  document.getElementById("skip-special").style.display = "none";
  renderCards();
  // Fin de tour après avoir ignoré le pouvoir spécial
  endPlayerTurn();
}

function declareCactus() {
  log("🌵 Cactus annoncé ! Tous les autres joueurs jouent encore un tour.");

  let cactusDeclared = true;

  // Sauvegarder l'état du joueur
  const cactusPlayerCards = [...playerCards];
  const cactusPlayer = currentPlayer;

  // Passer au bot pour un dernier tour
  currentPlayer = "Bot";
  updateTurn();

  setTimeout(() => {
    botPlayTurn();

    // Une fois le bot joué, révéler les cartes
    setTimeout(() => {
      log("🌵 Fin de manche. Révélation des cartes :");
      log(`Main du joueur : ${cactusPlayerCards.join(", ")}`);
      log(`Main du bot : ${botCards.join(", ")}`);

      // Calcul basique pour vérifier si le joueur a gagné (somme <= 5)
      const cardValue = (c) => c === "R" ? 0 : c === "A" ? 1 : c === 2 ? -2 : ["V", "D", 10].includes(c) ? 10 : parseInt(c);
      const playerScore = cactusPlayerCards.map(cardValue).reduce((a, b) => a + b, 0);
      const botScore = botCards.map(cardValue).reduce((a, b) => a + b, 0);

      if (playerScore <= 5) {
        log(`✅ Cactus réussi ! Ton score est ${playerScore}.`);
      } else {
        log(`❌ Cactus raté... Ton score est ${playerScore}.`);
      }

      if (botScore <= 5) {
        log(`🤖 Le bot a aussi cactus avec un score de ${botScore}.`);
      }

      // Mise à jour du score et de l'affichage
      if (playerScore <= 5) playerPoints++;
      else botPoints++;
      const scoresList = document.getElementById("scores-list");
      if (scoresList) {
        scoresList.innerText = `${sessionStorage.getItem("username") || "Moi"}: ${playerPoints} - Bot: ${botPoints}`;
      }
      if (playerPoints >= targetScore || botPoints >= targetScore) {
        if (playerPoints > botPoints) {
          log("🏆 Vous remportez la partie !");
        } else if (botPoints > playerPoints) {
          log("🏆 Le bot remporte la partie !");
        } else {
          log("🤝 Égalité ! La partie se termine.");
        }
      } else {
        // Préparer la prochaine manche
        const nextBtn = document.getElementById("btn-next-round");
        if (!nextBtn) {
          const btn = document.createElement("button");
          btn.id = "btn-next-round";
          btn.innerText = "Nouvelle manche";
          btn.addEventListener("click", () => {
            btn.style.display = "none";
            log("🔄 Nouvelle manche...");
            startNewGame();
          });
          document.getElementById("game").appendChild(btn);
        }
        document.getElementById("btn-next-round").style.display = "inline-block";
      }
    }, 1500);
  }, 1500);
}

window.addEventListener("DOMContentLoaded", () => {
  // Attacher les écouteurs d'événements aux boutons
  document.getElementById("btn-login")?.addEventListener("click", login);
  document.getElementById("btn-create-room")?.addEventListener("click", safeCreateRoom);
  document.getElementById("btn-join-room")?.addEventListener("click", joinRoom);

  document.getElementById("btn-launch-setup")?.addEventListener("click", launchSetup);
  document.getElementById("btn-save-config")?.addEventListener("click", saveGameConfig);
  document.getElementById("btn-start-game")?.addEventListener("click", startNewGame);
  document.getElementById("btn-draw-card")?.addEventListener("click", drawCard);

  document.getElementById("btn-discard-swap")?.addEventListener("click", initiateDiscardSwap);
  document.getElementById("btn-declare-cactus")?.addEventListener("click", declareCactus);
  document.getElementById("skip-special")?.addEventListener("click", skipSpecial);
});
