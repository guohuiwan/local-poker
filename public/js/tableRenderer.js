// Table rendering utilities

const SUIT_SYMBOLS = {
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  spades: '♠'
};

const SUIT_COLORS = {
  hearts: 'card-red',
  diamonds: 'card-red',
  clubs: 'card-black',
  spades: 'card-black'
};

function createCardElement(card, options = {}) {
  const el = document.createElement('div');
  const sizeClass = options.small ? 'card-small' : '';
  const colorClass = SUIT_COLORS[card.suit] || 'card-black';

  el.className = `card ${sizeClass} ${colorClass} ${options.dealing ? 'dealing' : ''}`.trim();
  el.innerHTML = `
    <span class="card-rank">${card.rank}</span>
    <span class="card-suit">${SUIT_SYMBOLS[card.suit]}</span>
  `;
  return el;
}

function createCardBack(options = {}) {
  const el = document.createElement('div');
  const sizeClass = options.small ? 'card-small' : '';
  el.className = `card card-back ${sizeClass}`;
  return el;
}

// Calculate player positions around the elliptical table
// Current player is always at the bottom center
function getPlayerPositions(totalPlayers, myIndex) {
  const positions = [];

  // Position angles: start from bottom (my player) and go clockwise
  // We distribute players evenly around the ellipse
  for (let i = 0; i < totalPlayers; i++) {
    // Offset so myIndex maps to bottom (270 degrees / 1.5*PI)
    const offset = ((i - myIndex + totalPlayers) % totalPlayers) / totalPlayers;
    const angle = (offset * 2 * Math.PI) - Math.PI / 2; // Start from bottom

    // Ellipse: the table container positions
    // Use percentages relative to the table element
    const rx = 50; // % of table width (half-width)
    const ry = 50; // % of table height (half-height)

    const x = 50 + rx * Math.sin(angle + Math.PI); // % from left
    const y = 50 + ry * Math.cos(angle + Math.PI); // % from top

    positions.push({ x, y, isBottom: i === myIndex });
  }

  return positions;
}

// Get bet chip position (between player and center)
function getBetPosition(playerPos) {
  const centerX = 50;
  const centerY = 50;
  // Position bet 40% of the way from player to center
  return {
    x: playerPos.x + (centerX - playerPos.x) * 0.45,
    y: playerPos.y + (centerY - playerPos.y) * 0.45
  };
}

function renderPlayerSeat(player, position, isMe) {
  const seat = document.createElement('div');
  seat.className = 'player-seat';
  seat.id = `seat-${player.id}`;

  if (player.isCurrent) seat.classList.add('is-current');
  if (player.folded) seat.classList.add('is-folded');
  if (player.disconnected) seat.classList.add('is-disconnected');

  // Position the seat
  seat.style.left = `${position.x}%`;
  seat.style.top = `${position.y}%`;
  seat.style.transform = 'translate(-50%, -50%)';

  // Player info box
  const info = document.createElement('div');
  info.className = 'player-info';

  if (isMe) {
    info.classList.add('is-me');
    const bubble = document.createElement('div');
    bubble.className = 'me-bubble';
    bubble.textContent = '我';
    info.appendChild(bubble);
  }

  // Badge (dealer/SB/BB)
  if (player.isDealer || player.isSB || player.isBB) {
    const badge = document.createElement('span');
    badge.className = 'player-badge';
    if (player.isDealer) {
      badge.classList.add('badge-dealer');
      badge.textContent = 'D';
    } else if (player.isSB) {
      badge.classList.add('badge-sb');
      badge.textContent = 'SB';
    } else if (player.isBB) {
      badge.classList.add('badge-bb');
      badge.textContent = 'BB';
    }
    info.appendChild(badge);
  }

  const nameEl = document.createElement('div');
  nameEl.className = 'player-name';
  nameEl.textContent = player.name;
  info.appendChild(nameEl);

  const chipsEl = document.createElement('div');
  chipsEl.className = 'player-chips';
  chipsEl.textContent = player.allIn ? 'ALL IN' : `$${player.chips}`;
  info.appendChild(chipsEl);

  seat.appendChild(info);

  if (player.totalBet > 0) {
    const totalBetEl = document.createElement('div');
    totalBetEl.className = 'player-total-bet-display';
    totalBetEl.textContent = `本局: $${player.totalBet}`;
    seat.appendChild(totalBetEl);
  }

  // Player hand (small cards for opponents, shown during showdown)
  if (!isMe && player.hand && player.hand.length > 0) {
    const handEl = document.createElement('div');
    handEl.className = 'player-hand';
    for (const card of player.hand) {
      handEl.appendChild(createCardElement(card, { small: true }));
    }
    seat.appendChild(handEl);
  } else if (!isMe && !player.folded && !player.sittingOut && player.hand === null) {
    // Show card backs for opponents in hand
    const handEl = document.createElement('div');
    handEl.className = 'player-hand';
    handEl.appendChild(createCardBack({ small: true }));
    handEl.appendChild(createCardBack({ small: true }));
    seat.appendChild(handEl);
  }

  return seat;
}

function renderBetChip(player, betPos, tableEl) {
  if (!player.bet || player.bet <= 0) return;

  const betEl = document.createElement('div');
  betEl.className = 'player-bet';
  betEl.textContent = `$${player.bet}`;
  betEl.style.left = `${betPos.x}%`;
  betEl.style.top = `${betPos.y}%`;
  betEl.style.transform = 'translate(-50%, -50%)';
  betEl.style.position = 'absolute';
  tableEl.appendChild(betEl);
}
