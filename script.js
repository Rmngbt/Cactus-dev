// ✅ script.js corrigé : gestion des tours, sélection initiale, nouvelle manche/partie, défausse rapide, fin de manche "Cactus"
let playerCards = [], botCards = [], discardPile = [];
let drawnCard = null;
let targetScore = 3;
let specialAction = null;
let jackSwapSelectedIndex = null;
let startVisibleCount = 2;
let cardCount = 4;
let currentPlayer = "Toi";
let revealedIndexes = [];
let mustGiveCardAfterEffect = false;
let pendingBotCardIndex = null;
let playerPoints = 0, botPoints = 0;
let selectingInitialCards = false;
let isHost = false;  // Indique si le joueur local est hôte

const CARD_POOL = ["R", "A", 2, 3, 4, 5, 6, 7, 8, 9, 10, "V", "D"];
const log = (msg) => {
  document.getElementById("log").innerHTML += `<p>${msg}</p>`;
  console.log(msg);
};

// Connexion de l'utilisateur, enregistrement du pseudo
function login() {
  const username = document.getElementById("username").value.trim();
  if (!username) return alert("Entre un pseudo pour continuer.");
  sessionStorage.setItem("username", username);
  document.getElementById("welcome").style.display = "none";
  document.getElementById("config").style.display = "block";
  document.getElementById("player-name").innerText = username;
  log(`👋 Bienvenue, ${username} !`);
}

// Création fictive d'une partie (hôte)
function safeCreateRoom() {
  log("🧪 Création fictive d'une partie...");
  isHost = true;
  document.getElementById("config").style.display = "none";
  document.getElementById("lobby").style.display = "block";
  document.getElementById("lobby-room").innerText = "TEST123";
  document.getElementById("lobby-players").innerHTML = `<li>Toi (hôte)</li><li>Bot</li>`;
  document.getElementById("btn-launch-setup").style.display = "inline-block";
}

// Rejoindre fictivement une partie existante (invité)
function joinRoom() {
  log("🧪 Rejoint fictivement une partie...");
  isHost = false;
  document.getElementById("config").style.display = "none";
  document.getElementById("lobby").style.display = "block";
  document.getElementById("lobby-room").innerText = "TEST123";
  document.getElementById("lobby-players").innerHTML = "<li>Bot (hôte)</li><li>Toi</li>";
  // Simule le lancement de la configuration par le bot après un délai
  setTimeout(() => {
    log("🚦 Le bot lance la configuration de la partie...");
    launchSetup();
  }, 2000);
}

// Affiche l'écran de configuration de la partie
function launchSetup() {
  document.getElementById("lobby").style.display = "none";
  document.getElementById("setup").style.display = "block";
}

// Enregistre la configuration entrée par l'hôte
function saveGameConfig() {
  startVisibleCount = parseInt(document.getElementById("visible-count").value);
  cardCount = parseInt(document.getElementById("card-count").value);
  targetScore = parseInt(document.getElementById("target-score").value);
  log(`💾 Config sauvegardée (Cartes: ${cardCount}, Visibles: ${startVisibleCount}, Cible: ${targetScore})`);
}

// Démarre une nouvelle partie / nouvelle manche
function startNewGame() {
  // Met à jour les configurations selon les inputs actuels
  saveGameConfig();
  // Prépare l'interface du jeu
  document.getElementById("setup").style.display = "none";
  document.getElementById("lobby").style.display = "none";
  document.getElementById("game").style.display = "block";
  // Distribue de nouvelles mains de cardCount cartes pour chaque joueur
  playerCards = Array.from({ length: cardCount }, () => CARD_POOL[Math.floor(Math.random() * CARD_POOL.length)]);
  botCards = Array.from({ length: cardCount }, () => CARD_POOL[Math.floor(Math.random() * CARD_POOL.length)]);
  discardPile = [];
  revealedIndexes = [];
  drawnCard = null;
  specialAction = null;
  jackSwapSelectedIndex = null;
  mustGiveCardAfterEffect = false;
  pendingBotCardIndex = null;
  // Réinitialise l'état spécial et cache le bouton de saut d'action spéciale
  document.getElementById("skip-special").style.display = "none";
  // Définit le joueur qui commence (l'hôte commence chaque manche)
  currentPlayer = isHost ? "Toi" : "Bot";
  // Gère l'affichage des boutons hôte uniquement
  document.getElementById("btn-stop-game").style.display = isHost ? "inline-block" : "none";
  document.getElementById("btn-new-round").style.display = "none";
  document.getElementById("btn-reset-game").style.display = "none";
  // Remet la pioche visible pour la nouvelle manche
  document.getElementById("draw-pile").style.visibility = "visible";
  // Phase de mémorisation : sélection initiale de cartes à révéler
  if (startVisibleCount > 0) {
    selectingInitialCards = true;
    log(`🃏 Sélectionne ${startVisibleCount} carte(s) à regarder.`);
  } else {
    selectingInitialCards = false;
    log("📌 Aucune carte à révéler en début de manche.");
  }
  renderCards();
  updateTurn();
}

// Pioche une carte du talon (si c'est au tour du joueur)
function drawCard() {
  if (selectingInitialCards) return log("⏳ Termine d'abord ta sélection de cartes.");
  if (currentPlayer !== "Toi") return log("⛔ Ce n'est pas ton tour !");
  drawnCard = CARD_POOL[Math.floor(Math.random() * CARD_POOL.length)];
  log(`🃏 Carte piochée : ${drawnCard}`);
  showDrawnCard();
}

// Affiche la dernière carte piochée (et bouton pour la défausser)
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

// Défausse la carte actuellement piochée
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

// Échange la carte piochée avec l'une des cartes du joueur (lors d'un clic sur une carte de la main après une pioche)
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

// 🔥 Tentative de défausse rapide d'une carte de sa main
function discardCardFromHand(index) {
  const card = playerCards[index];
  const topDiscard = discardPile[discardPile.length - 1];
  const normalize = (val) => (typeof val === "number" ? val : isNaN(val) ? val : parseInt(val));

  if (currentPlayer !== "Toi") {
    if (!topDiscard) return log("❌ Aucune carte dans la défausse.");
    if (normalize(card) === normalize(topDiscard)) {
      playerCards.splice(index, 1);
      discardPile.push(card);
      log(`⚡ Vous défaussez rapidement votre carte ${card} qui correspond à la défausse !`);
      checkSpecialEffect(card);
    } else {
      const penaltyCard = CARD_POOL[Math.floor(Math.random() * CARD_POOL.length)];
      playerCards.push(penaltyCard);
      log(`❌ Mauvaise tentative de défausse éclair. Vous piochez une carte de pénalité (${penaltyCard}).`);
    }
    renderCards();
    return;
  }

  // Si c'est le tour du joueur et qu'aucune carte piochée n'est en attente, on permet la défausse volontaire
  if (drawnCard !== null) {
    return log("⏳ Vous devez d'abord jouer ou défausser la carte piochée.");
  }
  // Défausse volontaire (sacrifice d'une carte de sa main en échange d'une nouvelle carte)
  discardPile.push(card);
  playerCards[index] = CARD_POOL[Math.floor(Math.random() * CARD_POOL.length)];
  log(`🗑 Défausse volontaire de la carte ${card}`);
  checkSpecialEffect(card);
  if (!specialAction) endPlayerTurn();
  renderCards();
}

// Prend la carte de la défausse (début de tour, effet similaire à piocher)
function initiateDiscardSwap() {
  if (currentPlayer !== "Toi") return log("⛔ Ce n'est pas ton tour !");
  if (discardPile.length === 0) return log("❌ Aucune carte dans la défausse");
  drawnCard = discardPile.pop();
  log(`🔁 Carte récupérée de la défausse : ${drawnCard}`);
  showDrawnCard();
}

// Met à jour l'affichage des cartes du joueur et de l'adversaire
function renderCards() {
  const handDiv = document.getElementById("player-hand");
  handDiv.innerHTML = "<h3>Moi</h3>";
  // Cartes du joueur
  playerCards.forEach((card, i) => {
    const wrap = document.createElement("div");
    wrap.className = "card-wrapper";
    const c = document.createElement("div");
    c.className = "card";
    if (selectingInitialCards) {
      c.classList.add("selectable-start");
      c.innerText = revealedIndexes.includes(i) ? card : "?";
      if (revealedIndexes.includes(i)) {
        c.classList.add("highlight");
      }
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
            // Si ce n'est pas l'hôte qui commence, le bot joue immédiatement
            if (currentPlayer === "Bot") {
              botPlayTurn();
            }
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

  // Cartes de l'adversaire (bot)
  const botDiv = document.getElementById("bot-hand");
  botDiv.innerHTML = "<h3>Adversaire</h3>";
  botCards.forEach((card, i) => {
    const wrap = document.createElement("div");
    wrap.className = "card-wrapper";
    const c = document.createElement("div");
    c.className = "card";
    c.innerText = "?";
    // Effets spéciaux éventuels
    if (specialAction === "lookOpp") {
      c.onclick = () => {
        log(`👁️ Carte du bot en position ${i + 1} : ${card}`);
        c.innerText = card;
        c.classList.add("highlight");
        document.getElementById("skip-special").style.display = "none";
        // Désactive les autres cartes pour éviter plusieurs révélations
        document.querySelectorAll('#bot-hand .card').forEach(elem => elem.onclick = null);
        setTimeout(() => {
          c.innerText = "?";
          c.classList.remove("highlight");
          specialAction = null;
          renderCards();
          endPlayerTurn();
        }, 3000);
      };
    } else if (specialAction === "swapJack" && jackSwapSelectedIndex !== null) {
      c.onclick = () => {
        const temp = botCards[i];
        botCards[i] = playerCards[jackSwapSelectedIndex];
        playerCards[jackSwapSelectedIndex] = temp;
        log(`🔄 Vous échangez votre carte en position ${jackSwapSelectedIndex + 1} avec celle du bot.`);
        specialAction = null;
        jackSwapSelectedIndex = null;
        document.getElementById("skip-special").style.display = "none";
        renderCards();
        endPlayerTurn();
      };
    } else {
      const btn = document.createElement("button");
      btn.innerText = "🗑";
      btn.className = "discard-btn";
      btn.onclick = () => discardOpponentCard(i);
      wrap.appendChild(btn);
    }
    wrap.appendChild(c);
    botDiv.appendChild(wrap);
  });

  // Affichage de la carte au sommet de la défausse
  const discardSpan = document.getElementById("discard");
  if (discardSpan) {
    const topDiscard = discardPile[discardPile.length - 1];
    discardSpan.innerText = topDiscard ?? "Vide";
  }
  // Mise à jour du score affiché
  const scoresList = document.getElementById("scores-list");
  if (scoresList) {
    scoresList.innerText = `${sessionStorage.getItem("username") || "Moi"}: ${playerPoints} - Bot: ${botPoints}`;
  }
}

// Tentative de défausse rapide sur une carte de l'adversaire (clic sur 🗑 du bot)
function discardOpponentCard(index) {
  const card = botCards[index];
  const topDiscard = discardPile[discardPile.length - 1];
  if (!topDiscard) return log("❌ Aucune carte dans la défausse.");

  const normalize = (val) => typeof val === "number" ? val : isNaN(val) ? val : parseInt(val);
  if (normalize(card) === normalize(topDiscard)) {
    log(`🎯 Bonne défausse ! La carte ${card} correspond à la défausse.`);
    discardPile.push(card);
    // Retire la carte de l'adversaire de son jeu
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

// Gestion du clic sur une carte du joueur (hors défausse rapide)
function handleCardClick(index, card) {
  if (selectingInitialCards) return log("⏳ Termine d'abord ta sélection de cartes.");
  if (specialAction === "revealSelf") {
    if (!revealedIndexes.includes(index)) {
      revealedIndexes.push(index);
    }
    log(`👁️ Vous regardez votre carte : ${card}`);
    const cardElems = document.querySelectorAll('#player-hand .card');
    const selectedCardElem = cardElems[index];
    selectedCardElem.innerText = card;
    selectedCardElem.classList.add('highlight');
    document.getElementById("skip-special").style.display = "none";
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

// Met à jour l'indication de tour
function updateTurn() {
  document.getElementById("turn-info").innerText = `Tour de ${currentPlayer}`;
}

// Termine le tour du joueur actuel et passe au suivant
function endPlayerTurn() {
  if (mustGiveCardAfterEffect) {
    // Après un effet spécial sur défausse rapide (8, 10, Valet), demander la carte à donner
    mustGiveCardAfterEffect = false;
    specialAction = "give";
    log("🎁 Choisissez une de vos cartes à transférer au bot.");
    document.getElementById("skip-special").style.display = "none";
    renderCards();
    return;
  }
  if (specialAction) {
    // Attend la fin d'une action spéciale avant de terminer le tour
    return;
  }
  // Alterne le joueur courant (Toi <-> Bot)
  currentPlayer = currentPlayer === "Toi" ? "Bot" : "Toi";
  updateTurn();
  if (currentPlayer === "Bot") {
    // Petite pause puis le bot joue
    setTimeout(botPlayTurn, 1000);
  }
}

// Tour du bot (IA simple)
function botPlayTurn() {
  // Le bot pioche une carte
  const card = CARD_POOL[Math.floor(Math.random() * CARD_POOL.length)];
  let actionLog = `🤖 Bot pioche ${card}. `;
  // Décision simple : garder ou défausser en comparant avec sa plus haute carte
  const valueMap = { "A": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, "10": 10, "V": 11, "D": 12, "R": 13 };
  const drawnValue = valueMap[card] || card;
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
    // Le bot remplace sa plus haute carte par la carte piochée
    const discarded = botCards[highestIndex];
    botCards[highestIndex] = card;
    discardPile.push(discarded);
    actionLog += `Il garde ${card} et défausse ${discarded}.`;
    // Vérifier les effets spéciaux de la carte défaussée par le bot
    if (discarded === 8 || discarded === "8") {
      // Le bot regarde une de ses cartes au hasard
      const peekIndex = Math.floor(Math.random() * botCards.length);
      log(`${actionLog} (Le bot regarde sa carte en position ${peekIndex+1}.)`);
    } else if (discarded === 10 || discarded === "10") {
      // Le bot regarde une des cartes du joueur au hasard
      const peekIndex = Math.floor(Math.random() * playerCards.length);
      const peekedCard = playerCards[peekIndex];
      log(`${actionLog} (Le bot regarde votre carte en position ${peekIndex+1} : ${peekedCard}.)`);
    } else if (discarded === "V" || discarded === "J" || discarded === 11) {
      // Le bot utilise l'effet du Valet : échange une carte au hasard avec le joueur
      const botIndex = Math.floor(Math.random() * botCards.length);
      const playerIndex = Math.floor(Math.random() * playerCards.length);
      const botCard = botCards[botIndex];
      const playerCard = playerCards[playerIndex];
      botCards[botIndex] = playerCard;
      playerCards[playerIndex] = botCard;
      log(`${actionLog} (Le bot a utilisé un Valet et a échangé sa carte en position ${botIndex+1} avec votre carte en position ${playerIndex+1}.)`);
      // Si la carte du joueur échangée était connue (révélée), on l'oublie maintenant
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
  // Fin du tour du bot, repasse au joueur
  currentPlayer = "Toi";
  updateTurn();
}

// Ignore l'effet spécial en cours (bouton "Passer l'action spéciale")
function skipSpecial() {
  if (!specialAction) return;
  log("⏭ Vous ignorez l'effet spécial en cours.");
  // Annule l'action spéciale en cours
  specialAction = null;
  jackSwapSelectedIndex = null;
  document.getElementById("skip-special").style.display = "none";
  renderCards();
  endPlayerTurn();
}

// Déclare "Cactus" pour terminer la manche après le tour des autres joueurs
function declareCactus() {
  if (selectingInitialCards) return log("⏳ Termine d'abord ta sélection de cartes.");
  log("🌵 Cactus annoncé ! Tous les autres joueurs jouent encore un tour.");
  // Mémorise l'état du joueur déclarant le cactus
  const cactusPlayerCards = [...playerCards];
  const cactusPlayerName = sessionStorage.getItem("username") || "Joueur";
  // Les autres joueurs (ici le bot) jouent leur dernier tour
  currentPlayer = "Bot";
  updateTurn();
  setTimeout(() => {
    botPlayTurn();
    // Après le tour du bot, on révèle toutes les cartes et on détermine le vainqueur de la manche
    setTimeout(() => {
      log("🌵 Fin de manche. Révélation des cartes :");
      log(`Main du joueur : ${cactusPlayerCards.join(", ")}`);
      log(`Main du bot : ${botCards.join(", ")}`);
      // Calcul des scores de la manche
      const cardValue = (c) => c === "R" ? 0 : c === "A" ? 1 : c === 2 ? -2 : ["V", "D", 10, "10", "J"].includes(c) ? 10 : parseInt(c);
      const playerScore = cactusPlayerCards.map(cardValue).reduce((a, b) => a + b, 0);
      const botScore = botCards.map(cardValue).reduce((a, b) => a + b, 0);
      if (playerScore <= 5) {
        log(`✅ Cactus réussi ! Ton score est ${playerScore}.`);
      } else {
        log(`❌ Cactus raté... Ton score est ${playerScore}.`);
      }
      if (botScore <= 5) {
        log(`🤖 Le bot a aussi un score de ${botScore} (cactus).`);
      } else {
        log(`🤖 Score du bot : ${botScore}.`);
      }
      // Affiche le gagnant de la manche au centre du plateau
      document.getElementById("draw-pile").style.visibility = "hidden";
      let winnerName;
      if (playerScore < botScore) {
        winnerName = cactusPlayerName;
      } else if (botScore < playerScore) {
        winnerName = "Bot";
      } else {
        winnerName = null;
      }
      if (winnerName) {
        document.getElementById("turn-info").innerText = `Manche remportée par ${winnerName} !`;
      } else {
        document.getElementById("turn-info").innerText = "Égalité de la manche !";
      }
      // Mise à jour des scores cumulés (point au vainqueur de la manche)
      if (playerScore <= 5) playerPoints++;
      else botPoints++;
      // Vérifie si la partie se termine (score cible atteint)
      if (playerPoints >= targetScore || botPoints >= targetScore) {
        if (playerPoints > botPoints) {
          log("🏆 Vous remportez la partie !");
        } else if (botPoints > playerPoints) {
          log("🏆 Le bot remporte la partie !");
        } else {
          log("🤝 Égalité ! La partie se termine.");
        }
        // Affiche le bouton "Nouvelle partie" pour l'hôte ou réinitialise automatiquement pour l'invité
        if (isHost) {
          document.getElementById("btn-reset-game").style.display = "inline-block";
        } else {
          setTimeout(() => {
            resetGame();
          }, 5000);
        }
      } else {
        // Prépare la prochaine manche : bouton pour l'hôte, auto pour l'invité
        if (isHost) {
          document.getElementById("btn-new-round").style.display = "inline-block";
        } else {
          setTimeout(() => {
            log("🔄 Nouvelle manche...");
            startNewGame();
          }, 5000);
        }
      }
    }, 1500);
  }, 1500);
}

// Réinitialise complètement la partie et renvoie les joueurs au lobby (nouvelle partie)
function resetGame() {
  // Affiche le lobby et masque le plateau de jeu
  document.getElementById("game").style.display = "none";
  document.getElementById("lobby").style.display = "block";
  // Le bouton de configuration est disponible pour l'hôte
  document.getElementById("btn-launch-setup").style.display = isHost ? "inline-block" : "none";
  // Réinitialise les variables de jeu
  playersData = {};
  playerCards = [];
  botCards = [];
  discardPile = [];
  drawnCard = null;
  specialAction = null;
  jackSwapSelectedIndex = null;
  revealedIndexes = [];
  selectingInitialCards = false;
  mustGiveCardAfterEffect = false;
  pendingBotCardIndex = null;
  playerPoints = 0;
  botPoints = 0;
  // Réinitialise l'affichage du score et la configuration
  const username = sessionStorage.getItem("username") || "Moi";
  document.getElementById("player-name").innerText = username;
  document.getElementById("scores-list").innerText = `${username}: 0 - Bot: 0`;
  document.getElementById("card-count").value = 4;
  document.getElementById("visible-count").value = 2;
  document.getElementById("target-score").value = 3;
  // Vide le journal d'action
  document.getElementById("log").innerHTML = "";
  log("🔁 Partie réinitialisée.");
}

// Attache les écouteurs d'événements aux boutons dès le chargement du DOM
window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("btn-login")?.addEventListener("click", login);
  document.getElementById("btn-create-room")?.addEventListener("click", safeCreateRoom);
  document.getElementById("btn-join-room")?.addEventListener("click", joinRoom);
  document.getElementById("btn-launch-setup")?.addEventListener("click", launchSetup);
  document.getElementById("btn-save-config")?.addEventListener("click", saveGameConfig);
  document.getElementById("btn-start-game")?.addEventListener("click", startNewGame);
  document.getElementById("btn-draw-card")?.addEventListener("click", drawCard);
  document.getElementById("btn-discard-swap")?.addEventListener("click", initiateDiscardSwap);
  document.getElementById("skip-special")?.addEventListener("click", skipSpecial);
  document.getElementById("btn-declare-cactus")?.addEventListener("click", declareCactus);
  document.getElementById("btn-stop-game")?.addEventListener("click", resetGame);
  document.getElementById("btn-new-round")?.addEventListener("click", () => {
    document.getElementById("btn-new-round").style.display = "none";
    log("🔄 Nouvelle manche...");
    startNewGame();
  });
  document.getElementById("btn-reset-game")?.addEventListener("click", resetGame);
});
