const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true }));

const SUITS = ['♠️', '♣️', '❤️', '♦️'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8'];
const SKILLS = [
  { id: 'boost', name: 'ブースト', desc: '山札からカードを1枚引く' },
  { id: 'skip', name: 'スキップ', desc: 'このターンを終了する' },
  { id: 'fight', name: 'ファイト', desc: '銀コインを1枚得る' },
  { id: 'change', name: 'チェンジ', desc: '相手の公開ペア1組と自分の2組目を交換する' },
  { id: 'bind', name: 'バインド', desc: '相手1人に金コインを置く' },
  { id: 'break', name: 'ブレイク', desc: '条件を満たす相手のペアを破壊する' },
  { id: 'shot', name: 'ショット', desc: '持ち点2点以上の相手を1点減らす' },
  { id: 'trap', name: 'トラップ', desc: '相手1人に銅コインを置く' }
];
const rooms = new Map();

function safeName(value, fallback = 'プレイヤー') {
  const name = String(value || '').trim().replace(/[<>]/g, '').slice(0, 16);
  return name || fallback;
}
function randomRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}
function addLog(room, text, type = 'normal') {
  room.logs.push({ text, type, time: Date.now() });
  if (room.logs.length > 160) room.logs.splice(0, room.logs.length - 160);
}
function cloneCard(card) {
  return card ? { suit: card.suit, rank: card.rank } : null;
}
function clonePair(pair) {
  return pair.map(cloneCard);
}
function cardLabel(card) {
  return card ? `${card.suit}${card.rank}` : '不明なカード';
}
function playerLabel(p) {
  return p ? p.name : '空席';
}
function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank });
      deck.push({ suit, rank });
    }
  }
  return deck;
}
function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
function rankNum(rank) {
  return rank === 'A' ? 1 : Number.parseInt(rank, 10);
}
function isValidPair(a, b) {
  if (!a || !b || a.suit !== b.suit) return false;
  if (a.rank === b.rank) return true;
  const r1 = rankNum(a.rank), r2 = rankNum(b.rank);
  return Math.abs(r1 - r2) === 1 || (r1 === 1 && r2 === 8) || (r1 === 8 && r2 === 1);
}
function findAllPairsInHand(hand) {
  const pairs = [];
  for (let i = 0; i < hand.length; i++) {
    for (let j = i + 1; j < hand.length; j++) {
      if (isValidPair(hand[i], hand[j])) pairs.push([i, j]);
    }
  }
  return pairs;
}
function combinations(arr, k) {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [head, ...tail] = arr;
  return [
    ...combinations(tail, k - 1).map(c => [head, ...c]),
    ...combinations(tail, k)
  ];
}
function calculateYaku(pairs4, isCatch) {
  const cards = pairs4.flat();
  const suitsSet = new Set(cards.map(c => c.suit));
  const ranksSet = new Set(cards.map(c => c.rank));
  const hasSpade = suitsSet.has('♠️');
  const hasClub = suitsSet.has('♣️');
  const hasHeart = suitsSet.has('❤️');
  const hasDiamond = suitsSet.has('♦️');
  let totalScore = 0;
  const yakuList = [];

  if (hasSpade && hasClub && hasHeart && hasDiamond) { totalScore += 1; yakuList.push('フォーマーク(1点)'); }
  if (hasSpade && hasClub && !hasHeart && !hasDiamond) { totalScore += 2; yakuList.push('ブラックマーク(2点)'); }
  if (hasHeart && hasDiamond && !hasSpade && !hasClub) { totalScore += 2; yakuList.push('レッドマーク(2点)'); }
  if (suitsSet.size === 1) { totalScore += 4; yakuList.push('フラッシュ(4点)'); }
  if (ranksSet.size === 8) { totalScore += 4; yakuList.push('ストレート(4点)'); }

  let a8Count = 0;
  for (const pair of pairs4) {
    if (pair[0].suit === pair[1].suit &&
      ((pair[0].rank === 'A' && pair[1].rank === '8') || (pair[0].rank === '8' && pair[1].rank === 'A'))) a8Count++;
  }
  if (a8Count === 1 && isCatch) { totalScore += 1; yakuList.push('ワンワンエイト(1点)'); }

  const samePairCount = pairs4.filter(pair => pair[0].suit === pair[1].suit && pair[0].rank === pair[1].rank).length;
  if (samePairCount === 4) { totalScore += 4; yakuList.push('フォーマッチ(4点)'); }
  else if (samePairCount === 3) { totalScore += 2; yakuList.push('スリーマッチ(2点)'); }
  else if (samePairCount === 2) { totalScore += 1; yakuList.push('ツーマッチ(1点)'); }
  else if (samePairCount === 1 && isCatch) { totalScore += 1; yakuList.push('ワンマッチ(1点)'); }

  if (ranksSet.size === 1) { totalScore += 100; yakuList.push('ワンナンバー(100点)'); }
  else if (ranksSet.size === 2) { totalScore += 4; yakuList.push('ツーナンバー(4点)'); }
  else if (ranksSet.size === 3) { totalScore += 2; yakuList.push('スリーナンバー(2点)'); }
  else if (ranksSet.size === 4) { totalScore += 1; yakuList.push('フォーナンバー(1点)'); }
  return { totalScore, yakuList };
}
function findAllScoringSets(openPairs, newPair, isCatch) {
  if (openPairs.length < 3) return [];
  const choices = openPairs.length === 3
    ? [openPairs.map((pair, i) => ({ pair, index: i }))]
    : combinations(openPairs.map((pair, index) => ({ pair, index })), 3);
  const valid = [];
  for (const chosen of choices) {
    const pairs4 = [...chosen.map(x => x.pair), newPair];
    const { totalScore, yakuList } = calculateYaku(pairs4, isCatch);
    if (totalScore >= 1) {
      valid.push({
        totalScore, yakuList, pairs4,
        openIndices: chosen.map(x => x.index)
      });
    }
  }
  return valid;
}
function bestScoringSet(openPairs, newPair, isCatch) {
  const valid = findAllScoringSets(openPairs, newPair, isCatch);
  return valid.reduce((best, item) => !best || item.totalScore > best.totalScore ? item : best, null);
}
function catchCandidates(room, playerId) {
  const p = room.players[playerId];
  const required = p.goldCoins > 0 ? 4 : 3;
  if (p.openPairs.length < required) return [];
  const out = [];
  for (const other of room.players) {
    if (other.id === p.id || other.discardPile.length === 0) continue;
    const topCard = other.discardPile[other.discardPile.length - 1];
    for (let handIndex = 0; handIndex < p.hand.length; handIndex++) {
      const myCard = p.hand[handIndex];
      if (!isValidPair(topCard, myCard)) continue;
      const results = findAllScoringSets(p.openPairs, [topCard, myCard], true);
      for (const result of results) {
        out.push({
          id: out.length,
          targetId: other.id,
          targetName: other.name,
          targetCard: cloneCard(topCard),
          myCard: cloneCard(myCard),
          handIndex,
          totalScore: result.totalScore,
          yakuList: result.yakuList,
          pairs4: result.pairs4.map(clonePair)
        });
      }
    }
  }
  return out;
}
function connectCandidates(room, playerId) {
  const p = room.players[playerId];
  const required = p.goldCoins > 0 ? 4 : 3;
  if (p.openPairs.length < required) return [];
  const out = [];
  for (const [i, j] of findAllPairsInHand(p.hand)) {
    const newPair = [p.hand[i], p.hand[j]];
    const results = findAllScoringSets(p.openPairs, newPair, false);
    for (const result of results) {
      out.push({
        id: out.length, i, j,
        openIndices: result.openIndices,
        totalScore: result.totalScore,
        yakuList: result.yakuList,
        pairs4: result.pairs4.map(clonePair),
        multiplier: p.silverCoins > 0 ? 2 : 1,
        damage: result.totalScore * (p.silverCoins > 0 ? 2 : 1)
      });
    }
  }
  return out;
}
function availableTargets(room, actorId, skillId) {
  return room.players.filter(p => {
    if (p.id === actorId) return false;
    if (skillId === 'change') return p.openPairs.length > 0;
    if (skillId === 'bind') return p.goldCoins === 0;
    if (skillId === 'break') return p.openPairs.length >= 3 && p.discardPile.length >= 2;
    if (skillId === 'shot') return p.score > 1;
    return skillId === 'trap';
  });
}
function skillOptions(room, actorId) {
  return SKILLS.map(skill => {
    if (['boost', 'skip', 'fight'].includes(skill.id)) return { ...skill, enabled: true, reason: '' };
    const targets = availableTargets(room, actorId, skill.id);
    let reason = '';
    if (!targets.length) {
      if (skill.id === 'change') reason = '相手に公開ペアがありません';
      if (skill.id === 'bind') reason = '金コインを置ける相手がいません';
      if (skill.id === 'break') reason = '公開ペア3組以上・捨て札2枚以上の相手がいません';
      if (skill.id === 'shot') reason = '持ち点2点以上の相手がいません';
    }
    return { ...skill, enabled: targets.length > 0, reason };
  });
}
function scoringText(candidate) {
  return `${candidate.yakuList.join('、')} / 合計${candidate.totalScore}点`;
}

function addHumanPlayer(id, name, socketId) {
  return {
    id, name: safeName(name, `プレイヤー${id + 1}`), isCpu: false, socketId,
    score: 15, hand: [], openPairs: [], discardPile: [],
    goldCoins: 0, silverCoins: 0, brownCoins: 0, usedSkillThisTurn: null
  };
}
function addCpuPlayer(id, score) {
  return {
    id, name: `CPU ${id}`, isCpu: true, socketId: null,
    score, hand: [], openPairs: [], discardPile: [],
    goldCoins: 0, silverCoins: 0, brownCoins: 0, usedSkillThisTurn: null
  };
}
function getRoomForSocket(socket) {
  const code = socket.data.roomCode;
  const room = code ? rooms.get(code) : null;
  if (!room) return { room: null, player: null };
  const player = room.players.find(p => p && p.socketId === socket.id) || null;
  return { room, player };
}
function lobbyView(room, socketId) {
  return {
    code: room.code,
    isHost: room.hostSocketId === socketId,
    initialScore: room.initialScore,
    players: room.players.map((p, i) => p ? {
      id: i, name: p.name, isCpu: false,
      isHost: p.socketId === room.hostSocketId
    } : null)
  };
}
function updateLobby(room) {
  for (const p of room.players) {
    if (p && p.socketId) io.to(p.socketId).emit('lobbyState', lobbyView(room, p.socketId));
  }
}
function publicState(room, myId) {
  const me = room.players[myId];
  const state = {
    status: room.status,
    code: room.code,
    myId,
    host: room.hostSocketId === me.socketId,
    initialScore: room.initialScore,
    roundCount: room.roundCount,
    deckCount: room.deck.length,
    currentPlayerIndex: room.currentPlayerIndex,
    turnPhase: room.turnPhase,
    players: room.players.map(p => ({
      id: p.id, name: p.name, isCpu: p.isCpu, connected: Boolean(p.socketId),
      score: p.score, handCount: p.hand.length,
      ...(p.id === myId ? { hand: p.hand.map(cloneCard) } : {}),
      openPairs: p.openPairs.map(clonePair), discardPile: p.discardPile.map(cloneCard),
      goldCoins: p.goldCoins, silverCoins: p.silverCoins, brownCoins: p.brownCoins
    })),
    logs: room.logs.slice(-100),
    pendingBreak: room.pendingBreak ? {
      attackerId: room.pendingBreak.attackerId,
      targetId: room.pendingBreak.targetId,
      pair: clonePair(room.pendingBreak.pair),
      waitingForMe: room.pendingBreak.targetId === myId
    } : null,
    pendingSkill: room.pendingSkill && room.pendingSkill.actorId === myId ? {
      skillId: room.pendingSkill.skillId,
      targetId: room.pendingSkill.targetId,
      stage: room.pendingSkill.stage
    } : null,
    catchCandidates: [], openCandidates: [], connectCandidates: [],
    skillOptions: [], targetOptions: [], skillPairOptions: [],
    result: room.result || null
  };
  if (room.status === 'playing' && room.currentPlayerIndex === myId) {
    if (room.turnPhase === 'drawChoice') state.catchCandidates = catchCandidates(room, myId).map(c => ({
      id: c.id, targetId: c.targetId, targetName: c.targetName,
      targetCard: c.targetCard, myCard: c.myCard,
      totalScore: c.totalScore, yakuList: c.yakuList,
      damage: c.totalScore * 3, pairs4: c.pairs4
    }));
    if (room.turnPhase === 'main') {
      const p = room.players[myId];
      state.openCandidates = findAllPairsInHand(p.hand).map(([i, j]) => ({
        i, j, card1: cloneCard(p.hand[i]), card2: cloneCard(p.hand[j])
      }));
      state.connectCandidates = connectCandidates(room, myId);
    }
    if (room.turnPhase === 'skillChoice') state.skillOptions = skillOptions(room, myId);
    if (room.turnPhase === 'skillTarget' && room.pendingSkill?.actorId === myId) {
      state.targetOptions = availableTargets(room, myId, room.pendingSkill.skillId).map(p => ({ id: p.id, name: p.name, score: p.score, openPairs: p.openPairs.map(clonePair) }));
    }
    if (room.turnPhase === 'skillPair' && room.pendingSkill?.actorId === myId) {
      const target = room.players[room.pendingSkill.targetId];
      state.skillPairOptions = target ? target.openPairs.map((pair, index) => ({ index, pair: clonePair(pair) })) : [];
      state.skillTargetName = target?.name || '';
      state.skillId = room.pendingSkill.skillId;
    }
  }
  return state;
}
function updateViews(room) {
  if (!room) return;
  for (const p of room.players) {
    if (p && p.socketId) io.to(p.socketId).emit('gameState', publicState(room, p.id));
  }
}
function notify(socket, message, isError = false) {
  socket.emit('notice', { message, isError });
}

function resetRound(room) {
  room.roundCount += 1;
  room.deck = shuffle(createDeck());
  room.pendingBreak = null;
  room.pendingSkill = null;
  room.players.forEach(p => {
    p.hand = []; p.openPairs = []; p.discardPile = [];
    p.goldCoins = 0; p.silverCoins = 0; p.brownCoins = 0; p.usedSkillThisTurn = null;
  });
  for (let round = 0; round < 5; round++) {
    for (const p of room.players) if (room.deck.length) p.hand.push(room.deck.pop());
  }
  addLog(room, `--- ラウンド${room.roundCount} を開始しました ---`, 'important');
}
function startGame(room) {
  room.status = 'playing';
  room.roundCount = 0;
  room.lastWinnerId = -1;
  room.result = null;
  room.isGameOver = false;
  room.turnPhase = 'wait';
  room.cpuBusy = false;
  for (let i = 0; i < 4; i++) {
    if (!room.players[i]) room.players[i] = addCpuPlayer(i, room.initialScore);
    else {
      room.players[i].score = room.initialScore;
      room.players[i].hand = []; room.players[i].openPairs = []; room.players[i].discardPile = [];
      room.players[i].goldCoins = 0; room.players[i].silverCoins = 0; room.players[i].brownCoins = 0;
    }
  }
  addLog(room, 'ゲームを開始しました。空席はCPUが担当します。', 'important');
  resetRound(room);
  room.currentPlayerIndex = 0;
  beginTurn(room);
}
function beginTurn(room) {
  if (!room || room.status !== 'playing' || room.isGameOver) return;
  const p = room.players[room.currentPlayerIndex];
  if (!p) return;
  p.usedSkillThisTurn = null;
  room.pendingSkill = null;
  addLog(room, `【ラウンド${room.roundCount} : ${p.name} のターン】`);
  if (p.isCpu) {
    room.turnPhase = 'cpu';
    updateViews(room);
    setTimeout(() => playCpuTurn(room), 250);
    return;
  }
  const catches = catchCandidates(room, p.id);
  if (catches.length) {
    room.turnPhase = 'drawChoice';
    addLog(room, `${p.name}: 【キャッチ】が可能です。キャッチするかドローするかを選んでください。`, 'important');
    updateViews(room);
  } else {
    drawForHuman(room, p.id);
  }
}
function startNextRound(room) {
  if (room.players.some(p => p.score <= 0)) {
    finishGame(room);
    return;
  }
  resetRound(room);
  room.currentPlayerIndex = 0;
  beginTurn(room);
}
function drawForHuman(room, playerId) {
  if (room.status !== 'playing') return;
  if (room.deck.length === 0) {
    addLog(room, '⚠ 山札が無くなったため仕切り直します。', 'important');
    resetRound(room);
    room.currentPlayerIndex = 0;
    beginTurn(room);
    return;
  }
  const p = room.players[playerId];
  p.hand.push(room.deck.pop());
  addLog(room, `${p.name}: 山札から1枚引きました。`);
  room.turnPhase = 'main';
  updateViews(room);
}
function endTurn(room) {
  if (room.status !== 'playing' || room.isGameOver) return;
  room.pendingSkill = null;
  room.pendingBreak = null;
  room.currentPlayerIndex = (room.currentPlayerIndex + 1) % 4;
  if (room.deck.length === 0) {
    addLog(room, '⚠ 山札が無くなったため仕切り直します。', 'important');
    resetRound(room);
    room.currentPlayerIndex = 0;
  }
  beginTurn(room);
}
function applyTraps(room, winnerId) {
  for (const p of room.players) {
    if (p.id !== winnerId && p.brownCoins > 0) {
      const damage = p.brownCoins * 2;
      p.score -= damage;
      addLog(room, `トラップ発動！ ${p.name} は銅コイン${p.brownCoins}枚の効果で追加で${damage}点失いました。`, 'important');
    }
  }
}
function finishRoundByWin(room, winnerId, winType, pairs4, yakuList, totalScore, multiplier, targetId = null, caughtCard = null, pairedHandCard = null) {
  const winner = room.players[winnerId];
  const finalScore = totalScore * multiplier;
  const damage = winType === 'キャッチ' ? finalScore * 3 : finalScore;
  if (winType === 'キャッチ') {
    room.players[targetId].score -= damage;
    const caughtDescription = caughtCard
      ? `${room.players[targetId].name} の捨て札「${cardLabel(caughtCard)}」`
      : `${room.players[targetId].name} の捨て札`;
    const pairDescription = pairedHandCard ? `（手札の「${cardLabel(pairedHandCard)}」とペア）` : '';
    addLog(room, `🎉 【キャッチ】 ${winner.name} が ${caughtDescription} をキャッチしてアガりました！${pairDescription} / 役: ${yakuList.join('、')} / ${totalScore}点${multiplier > 1 ? `×${multiplier}` : ''} / ダメージ${damage}点`, 'important');
  } else {
    room.players.forEach(p => { if (p.id !== winnerId) p.score -= damage; });
    addLog(room, `🎉 【コネクト】 ${winner.name} がアガりました！ 役: ${yakuList.join('、')} / ${totalScore}点${multiplier > 1 ? `×${multiplier}` : ''} / 全員に${damage}点`, 'important');
  }
  room.lastWinnerId = winnerId;
  applyTraps(room, winnerId);
  addLog(room, '【全プレイヤーの残り点数】 ' + room.players.map(p => `${p.name}: ${p.score}点`).join(' '), 'important');
  room.pendingBreak = null;
  room.pendingSkill = null;
  if (room.players.some(p => p.score <= 0)) finishGame(room);
  else startNextRound(room);
}
function finishGame(room) {
  room.isGameOver = true;
  room.status = 'finished';
  room.turnPhase = 'finished';
  const sorted = [...room.players].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.id === room.lastWinnerId) return -1;
    if (b.id === room.lastWinnerId) return 1;
    return b.id - a.id;
  });
  room.result = sorted.map((p, index) => ({ rank: index + 1, id: p.id, name: p.name, score: p.score }));
  addLog(room, '🏆 【ゲーム終了】最終順位: ' + sorted.map((p, i) => `${i + 1}位 ${p.name}（${p.score}点）`).join(' / '), 'important');
  updateViews(room);
}
function performCatch(room, playerId, candidateId) {
  const list = catchCandidates(room, playerId);
  const candidate = list.find(c => c.id === Number(candidateId));
  if (!candidate) return false;
  const p = room.players[playerId];
  const target = room.players[candidate.targetId];
  const currentTop = target.discardPile[target.discardPile.length - 1];
  const handCard = p.hand[candidate.handIndex];
  if (!currentTop || !handCard || currentTop.suit !== candidate.targetCard.suit || currentTop.rank !== candidate.targetCard.rank ||
      handCard.suit !== candidate.myCard.suit || handCard.rank !== candidate.myCard.rank) return false;
  // ログ用に、相手の捨て札と自分が組み合わせる手札を確保してから移動する。
  const caughtCard = cloneCard(currentTop);
  const pairedHandCard = cloneCard(handCard);
  target.discardPile.pop();
  p.hand.splice(candidate.handIndex, 1);
  finishRoundByWin(room, playerId, 'キャッチ', candidate.pairs4, candidate.yakuList, candidate.totalScore, 1, candidate.targetId, caughtCard, pairedHandCard);
  return true;
}
function performConnect(room, playerId, candidateId) {
  const list = connectCandidates(room, playerId);
  const candidate = list.find(c => c.id === Number(candidateId));
  if (!candidate) return false;
  const p = room.players[playerId];
  if (!p.hand[candidate.i] || !p.hand[candidate.j]) return false;
  p.hand.splice(candidate.j, 1);
  p.hand.splice(candidate.i, 1);
  finishRoundByWin(room, playerId, 'コネクト', candidate.pairs4, candidate.yakuList, candidate.totalScore, candidate.multiplier);
  return true;
}
function performOpen(room, playerId, i, j) {
  const p = room.players[playerId];
  i = Number(i); j = Number(j);
  if (!Number.isInteger(i) || !Number.isInteger(j) || i === j || !p.hand[i] || !p.hand[j] || !isValidPair(p.hand[i], p.hand[j])) return false;
  if (i > j) [i, j] = [j, i];
  const c2 = p.hand.splice(j, 1)[0];
  const c1 = p.hand.splice(i, 1)[0];
  p.openPairs.push([c1, c2]);
  addLog(room, `${p.name}: ペア (${cardLabel(c1)}, ${cardLabel(c2)}) をオープンしました。（公開${p.openPairs.length}組）`);
  let drew = false;
  if (room.deck.length > 0) {
    p.hand.push(room.deck.pop());
    addLog(room, `${p.name}: オープン効果で山札から1枚引きました。`);
    drew = true;
  }
  if (p.openPairs.length === 2 && drew) {
    if (p.isCpu) {
      room.turnPhase = 'cpu';
      updateViews(room);
      return 'skill';
    }
    room.turnPhase = 'skillChoice';
    updateViews(room);
  } else {
    room.turnPhase = p.isCpu ? 'cpu' : 'main';
    updateViews(room);
  }
  return true;
}
function destroyPair(room, actorId, targetId, pairIdx) {
  const actor = room.players[actorId];
  const target = room.players[targetId];
  const destroyed = target.openPairs.splice(pairIdx, 1)[0];
  if (!destroyed) return false;
  addLog(room, `${target.name} のペア (${cardLabel(destroyed[0])}, ${cardLabel(destroyed[1])}) が ${actor.name} のブレイクで破壊されました。`, 'important');
  if (target.isCpu) {
    target.discardPile.push(...destroyed);
    const drawn = target.discardPile.splice(0, Math.min(2, target.discardPile.length));
    target.hand.push(...drawn);
    addLog(room, `${target.name} は捨て札の古いカード${drawn.length}枚を引きました。`);
    return false;
  }
  room.pendingBreak = { attackerId, targetId, pair: destroyed };
  room.turnPhase = 'breakDefense';
  addLog(room, `${target.name}: 捨て札へ置くカードの順番を選んでください。`, 'important');
  updateViews(room);
  return true;
}
function applySkill(room, actorId, skillId, targetId = null, pairIdx = null) {
  const actor = room.players[actorId];
  const target = targetId === null ? null : room.players[targetId];
  actor.usedSkillThisTurn = skillId;
  addLog(room, `✨ ${actor.name} が特殊能力【${SKILLS.find(s => s.id === skillId)?.name || skillId}】を発動！`, 'skill');
  room.pendingSkill = null;
  if (skillId === 'boost') {
    if (room.deck.length > 0) actor.hand.push(room.deck.pop());
    addLog(room, `${actor.name}: 山札から1枚引きました。`);
  } else if (skillId === 'fight') {
    actor.silverCoins++;
    addLog(room, `${actor.name}: 銀コインを1枚獲得しました。`);
  } else if (skillId === 'skip') {
    addLog(room, `${actor.name}: スキップによりターンを終了します。`);
    endTurn(room);
    return 'ended';
  } else if (skillId === 'bind' && target && target.goldCoins === 0) {
    target.goldCoins++;
    addLog(room, `${target.name} に金コインを置きました。4組オープンするまでアガれません。`);
  } else if (skillId === 'shot' && target && target.score > 1) {
    target.score--;
    addLog(room, `${target.name} の持ち点が1点減少し、${target.score}点になりました。`);
    if (room.players.some(p => p.score <= 0)) { finishGame(room); return 'ended'; }
  } else if (skillId === 'trap' && target) {
    target.brownCoins++;
    addLog(room, `${target.name} に銅コインを1枚置きました。`);
  } else if (skillId === 'change' && target && target.openPairs[pairIdx] && actor.openPairs[1]) {
    const theirs = target.openPairs[pairIdx];
    const mine = actor.openPairs[1];
    target.openPairs[pairIdx] = mine;
    actor.openPairs[1] = theirs;
    addLog(room, `${actor.name} は ${target.name} のペアと自分の2組目のペアを交換しました。`);
  } else if (skillId === 'break' && target && target.openPairs[pairIdx] && target.openPairs.length >= 3 && target.discardPile.length >= 2) {
    const waiting = destroyPair(room, actorId, targetId, Number(pairIdx));
    if (waiting) return 'waiting';
  }
  if (room.status === 'playing') {
    room.turnPhase = actor.isCpu ? 'cpu' : 'main';
    updateViews(room);
  }
  return 'done';
}
function useCpuSkill(room, actorId) {
  const actor = room.players[actorId];
  const ids = skillOptions(room, actorId).filter(s => s.enabled).map(s => s.id);
  if (!ids.length) return false;
  const skillId = ids[Math.floor(Math.random() * ids.length)];
  let target = null;
  if (!['boost', 'skip', 'fight'].includes(skillId)) {
    const list = availableTargets(room, actorId, skillId);
    if (!list.length) return false;
    target = list[Math.floor(Math.random() * list.length)];
  }
  let pairIdx = null;
  if (skillId === 'change') pairIdx = Math.floor(Math.random() * target.openPairs.length);
  if (skillId === 'break') pairIdx = Math.floor(Math.random() * target.openPairs.length);
  return applySkill(room, actorId, skillId, target ? target.id : null, pairIdx);
}
async function playCpuTurn(room) {
  if (!room || room.status !== 'playing' || !room.players[room.currentPlayerIndex]?.isCpu || room.cpuBusy) return;
  room.cpuBusy = true;
  try {
    const p = room.players[room.currentPlayerIndex];
    room.turnPhase = 'cpu';
    updateViews(room);
    await pause(300);
    if (room.status !== 'playing' || room.currentPlayerIndex !== p.id) return;
    const catches = catchCandidates(room, p.id);
    if (catches.length) {
      const best = catches.reduce((a, b) => b.totalScore > a.totalScore ? b : a, catches[0]);
      performCatch(room, p.id, best.id);
      return;
    }
    if (!room.deck.length) {
      addLog(room, '⚠ 山札が無くなったため仕切り直します。', 'important');
      resetRound(room); room.currentPlayerIndex = 0; beginTurn(room); return;
    }
    p.hand.push(room.deck.pop());
    addLog(room, `${p.name}: 山札から1枚引きました。`);
    updateViews(room);
    await runCpuMain(room, p.id);
  } finally {
    room.cpuBusy = false;
  }
}
function pause(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function runCpuMain(room, playerId) {
  const p = room.players[playerId];
  while (room.status === 'playing' && room.currentPlayerIndex === playerId && p.isCpu) {
    await pause(250);
    if (room.status !== 'playing' || room.currentPlayerIndex !== playerId) return;
    const required = p.goldCoins > 0 ? 4 : 3;
    if (p.openPairs.length >= required) {
      const options = connectCandidates(room, playerId);
      if (options.length) {
        const best = options.reduce((a, b) => b.totalScore > a.totalScore ? b : a, options[0]);
        performConnect(room, playerId, best.id);
        return;
      }
    }
    const pairs = findAllPairsInHand(p.hand);
    if (pairs.length) {
      const result = performOpen(room, playerId, pairs[0][0], pairs[0][1]);
      if (result === 'skill') {
        await pause(200);
        if (room.status !== 'playing' || room.currentPlayerIndex !== playerId) return;
        const outcome = useCpuSkill(room, playerId);
        if (outcome === 'waiting') return;
        if (outcome === 'ended' || room.status !== 'playing' || room.currentPlayerIndex !== playerId) return;
      }
      continue;
    }
    break;
  }
  if (room.status !== 'playing' || room.currentPlayerIndex !== playerId) return;
  await pause(250);
  if (p.hand.length <= 1) {
    addLog(room, `${p.name}: 手札1枚以下のためパスしました。`);
  } else {
    const idx = Math.floor(Math.random() * p.hand.length);
    const card = p.hand.splice(idx, 1)[0];
    p.discardPile.push(card);
    addLog(room, `${p.name}: ${cardLabel(card)} を捨てました。`);
  }
  updateViews(room);
  endTurn(room);
}
function performBreakDefense(room, targetId, order) {
  const pending = room.pendingBreak;
  if (!pending || pending.targetId !== targetId) return false;
  const target = room.players[targetId];
  const ordered = Number(order) === 1 ? [pending.pair[1], pending.pair[0]] : [pending.pair[0], pending.pair[1]];
  target.discardPile.push(...ordered);
  const drawn = target.discardPile.splice(0, Math.min(2, target.discardPile.length));
  target.hand.push(...drawn);
  addLog(room, `${target.name}: ブレイクされたペアを指定順に捨て札へ置き、古いカード${drawn.length}枚を引きました。`);
  room.pendingBreak = null;
  const actor = room.players[room.currentPlayerIndex];
  room.turnPhase = actor.isCpu ? 'cpu' : 'main';
  updateViews(room);
  if (actor.isCpu) setTimeout(() => runCpuMain(room, actor.id), 100);
  return true;
}

io.on('connection', socket => {
  socket.on('createRoom', data => {
    const score = Math.max(1, Math.min(1000, Number.parseInt(data?.initialScore, 10) || 15));
    const code = randomRoomCode();
    const room = {
      code, status: 'lobby', hostSocketId: socket.id, initialScore: score,
      players: Array(4).fill(null), deck: [], roundCount: 0, currentPlayerIndex: 0,
      turnPhase: 'wait', logs: [], pendingBreak: null, pendingSkill: null,
      result: null, lastWinnerId: -1, isGameOver: false, cpuBusy: false
    };
    room.players[0] = addHumanPlayer(0, safeName(data?.name, 'プレイヤー1'), socket.id);
    rooms.set(code, room);
    socket.join(`room:${code}`);
    socket.data.roomCode = code;
    socket.emit('joinedRoom', { code, seatId: 0 });
    updateLobby(room);
    notify(socket, `部屋 ${code} を作成しました。参加者が入ったらゲームを開始してください。`);
  });

  socket.on('joinRoom', data => {
    const code = String(data?.code || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return notify(socket, '部屋コードが見つかりません。', true);
    if (room.status !== 'lobby') return notify(socket, 'この部屋ではすでにゲームが始まっています。', true);
    const seatId = room.players.findIndex(p => !p);
    if (seatId < 0) return notify(socket, 'この部屋は満員です。', true);
    room.players[seatId] = addHumanPlayer(seatId, safeName(data?.name, `プレイヤー${seatId + 1}`), socket.id);
    socket.join(`room:${code}`);
    socket.data.roomCode = code;
    socket.emit('joinedRoom', { code, seatId });
    notify(socket, `部屋 ${code} に参加しました。ホストがゲームを開始するまでお待ちください。`);
    updateLobby(room);
  });

  socket.on('startGame', () => {
    const { room, player } = getRoomForSocket(socket);
    if (!room || !player) return notify(socket, '先に部屋を作成または参加してください。', true);
    if (room.status !== 'lobby') return notify(socket, 'ゲームはすでに始まっています。', true);
    if (socket.id !== room.hostSocketId) return notify(socket, 'ゲームを開始できるのはホストだけです。', true);
    startGame(room);
    updateViews(room);
  });

  socket.on('action', action => {
    const { room, player } = getRoomForSocket(socket);
    if (!room || !player) return notify(socket, '部屋情報が見つかりません。ページを再読み込みしてください。', true);
    if (room.status !== 'playing') return notify(socket, '現在ゲーム中ではありません。', true);
    const type = String(action?.type || '');
    const current = room.players[room.currentPlayerIndex];
    const isTurnPlayer = current && current.id === player.id;

    if (type === 'breakDefense') {
      if (!room.pendingBreak || room.pendingBreak.targetId !== player.id) return notify(socket, 'ブレイク対応の対象ではありません。', true);
      if (!performBreakDefense(room, player.id, action.order)) return notify(socket, 'ブレイク対応に失敗しました。', true);
      return;
    }
    if (!isTurnPlayer || player.isCpu) return notify(socket, '現在はあなたの手番ではありません。', true);

    if (type === 'draw') {
      if (room.turnPhase !== 'drawChoice') return notify(socket, '今はドローを選べません。', true);
      drawForHuman(room, player.id);
      return;
    }
    if (type === 'catch') {
      if (room.turnPhase !== 'drawChoice') return notify(socket, '今はキャッチできません。', true);
      if (!performCatch(room, player.id, action.candidateId)) return notify(socket, 'キャッチ候補が変わりました。画面を確認してください。', true);
      updateViews(room);
      return;
    }
    if (type === 'open') {
      if (room.turnPhase !== 'main') return notify(socket, '今はオープンできません。', true);
      if (!performOpen(room, player.id, action.i, action.j)) return notify(socket, 'その2枚ではペアを作れません。', true);
      return;
    }
    if (type === 'connect') {
      if (room.turnPhase !== 'main') return notify(socket, '今はコネクトできません。', true);
      if (!performConnect(room, player.id, action.candidateId)) return notify(socket, 'コネクト候補が変わりました。画面を確認してください。', true);
      updateViews(room);
      return;
    }
    if (type === 'discard') {
      if (room.turnPhase !== 'main') return notify(socket, '今は捨て札にできません。', true);
      const index = Number(action.index);
      if (!Number.isInteger(index) || player.hand.length <= 1 || !player.hand[index]) return notify(socket, 'そのカードは捨てられません。', true);
      const card = player.hand.splice(index, 1)[0];
      player.discardPile.push(card);
      addLog(room, `${player.name}: ${cardLabel(card)} を捨てました。`);
      endTurn(room);
      return;
    }
    if (type === 'pass') {
      if (room.turnPhase !== 'main' || player.hand.length > 1) return notify(socket, '手札が1枚以下の場合だけパスできます。', true);
      addLog(room, `${player.name}: 手札1枚以下のためパスしました。`);
      endTurn(room);
      return;
    }
    if (type === 'skipSkill') {
      if (room.turnPhase !== 'skillChoice') return notify(socket, '今は特殊能力を選べません。', true);
      addLog(room, `${player.name}: 特殊能力を使用しませんでした。`);
      room.turnPhase = 'main';
      updateViews(room);
      return;
    }
    if (type === 'chooseSkill') {
      if (room.turnPhase !== 'skillChoice') return notify(socket, '今は特殊能力を選べません。', true);
      const skillId = String(action.skillId || '');
      const option = skillOptions(room, player.id).find(s => s.id === skillId && s.enabled);
      if (!option) return notify(socket, 'その特殊能力は現在使用できません。', true);
      if (['boost', 'skip', 'fight'].includes(skillId)) {
        applySkill(room, player.id, skillId);
        return;
      }
      room.pendingSkill = { actorId: player.id, skillId, stage: 'target', targetId: null };
      room.turnPhase = 'skillTarget';
      updateViews(room);
      return;
    }
    if (type === 'cancelSkillSelection') {
      if (!['skillTarget', 'skillPair'].includes(room.turnPhase) || !room.pendingSkill || room.pendingSkill.actorId !== player.id) return notify(socket, '特殊能力の選択を戻せません。', true);
      room.pendingSkill = null;
      room.turnPhase = 'skillChoice';
      updateViews(room);
      return;
    }
    if (type === 'skillTarget') {
      if (room.turnPhase !== 'skillTarget' || !room.pendingSkill || room.pendingSkill.actorId !== player.id) return notify(socket, '対象を選ぶ段階ではありません。', true);
      const targetId = Number(action.targetId);
      if (!availableTargets(room, player.id, room.pendingSkill.skillId).some(p => p.id === targetId)) return notify(socket, 'その相手は対象にできません。', true);
      const skillId = room.pendingSkill.skillId;
      if (skillId === 'change' || skillId === 'break') {
        room.pendingSkill.targetId = targetId;
        room.pendingSkill.stage = 'pair';
        room.turnPhase = 'skillPair';
        updateViews(room);
      } else {
        applySkill(room, player.id, skillId, targetId);
      }
      return;
    }
    if (type === 'skillPair') {
      if (room.turnPhase !== 'skillPair' || !room.pendingSkill || room.pendingSkill.actorId !== player.id) return notify(socket, 'ペアを選ぶ段階ではありません。', true);
      const { skillId, targetId } = room.pendingSkill;
      const target = room.players[targetId];
      const pairIdx = Number(action.pairIdx);
      if (!target || !Number.isInteger(pairIdx) || !target.openPairs[pairIdx]) return notify(socket, 'そのペアは選べません。', true);
      if (skillId === 'break' && (target.openPairs.length < 3 || target.discardPile.length < 2)) return notify(socket, 'ブレイクの条件を満たしていません。', true);
      applySkill(room, player.id, skillId, targetId, pairIdx);
      return;
    }
    notify(socket, '不明な操作です。', true);
  });

  socket.on('disconnect', () => {
    const { room, player } = getRoomForSocket(socket);
    if (!room || !player) return;
    if (room.status === 'lobby') {
      room.players[player.id] = null;
      if (room.hostSocketId === socket.id) {
        const nextHost = room.players.find(p => p && p.socketId);
        room.hostSocketId = nextHost ? nextHost.socketId : null;
      }
      if (!room.players.some(p => p && p.socketId)) rooms.delete(room.code);
      else updateLobby(room);
      return;
    }
    player.socketId = null;
    player.isCpu = true;
    player.name = `${player.name}（CPU代行）`;
    addLog(room, `${player.name} が切断したため、以後CPUが操作します。`, 'important');
    if (room.hostSocketId === socket.id) {
      const nextHost = room.players.find(p => p && p.socketId);
      room.hostSocketId = nextHost ? nextHost.socketId : null;
    }
    if (room.pendingBreak && room.pendingBreak.targetId === player.id) {
      performBreakDefense(room, player.id, 0);
    } else if (room.currentPlayerIndex === player.id && !room.cpuBusy) {
      if (room.turnPhase === 'drawChoice' || room.turnPhase === 'cpu') {
        room.turnPhase = 'cpu';
        setTimeout(() => playCpuTurn(room), 100);
      } else if (['main', 'skillChoice', 'skillTarget', 'skillPair'].includes(room.turnPhase)) {
        room.pendingSkill = null;
        room.turnPhase = 'cpu';
        setTimeout(() => runCpuMain(room, player.id), 100);
      }
    }
    updateViews(room);
  });
});

server.listen(PORT, () => {
  console.log(`キャッチ＆コネクト online server listening on ${PORT}`);
});
