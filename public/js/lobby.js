(function() {
  const socket = socketClient.connect();

  const btnCreate = document.getElementById('btn-create');
  const btnJoin = document.getElementById('btn-join');
  const createError = document.getElementById('create-error');
  const joinError = document.getElementById('join-error');

  btnCreate.addEventListener('click', () => {
    const name = document.getElementById('create-name').value.trim();
    const chips = parseInt(document.getElementById('create-chips').value) || 1000;
    const bb = parseInt(document.getElementById('create-bb').value) || 20;

    if (!name) {
      createError.textContent = '请输入昵称';
      return;
    }

    createError.textContent = '';
    btnCreate.disabled = true;

    socket.emit('room:create', {
      playerName: name,
      initialChips: chips,
      smallBlind: Math.floor(bb / 2),
      bigBlind: bb
    }, (res) => {
      btnCreate.disabled = false;
      if (res.success) {
        socketClient.setSession(res.roomId, res.playerId, name);
        window.location.href = '/game.html';
      } else {
        createError.textContent = res.error;
      }
    });
  });

  btnJoin.addEventListener('click', () => {
    const name = document.getElementById('join-name').value.trim();
    const roomId = document.getElementById('join-room').value.trim().toUpperCase();

    if (!name) {
      joinError.textContent = '请输入昵称';
      return;
    }
    if (!roomId) {
      joinError.textContent = '请输入房间号';
      return;
    }

    joinError.textContent = '';
    btnJoin.disabled = true;

    socket.emit('room:join', {
      playerName: name,
      roomId: roomId
    }, (res) => {
      btnJoin.disabled = false;
      if (res.success) {
        socketClient.setSession(res.roomId, res.playerId, name);
        window.location.href = '/game.html';
      } else {
        joinError.textContent = res.error;
      }
    });
  });

  // Allow Enter key to submit
  document.getElementById('create-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') btnCreate.click();
  });
  document.getElementById('join-room').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') btnJoin.click();
  });

  // Show server IP info
  const serverInfo = document.getElementById('server-info');
  serverInfo.innerHTML = `局域网其他设备请访问: <code>${window.location.origin}</code>`;
})();
