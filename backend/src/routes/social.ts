import { Router, Request, Response } from 'express';
import {
  getCollectionItems,
  findOneItem,
  insertItem,
  updateItem,
  deleteItem,
} from '../db/mongo.js';
import { getUserProfile } from '../services/progression.js';
import { getUserWeeklyChallenges, claimWeeklyChallengeReward } from '../services/challenges.js';
import { getUserPresence } from '../socket/presence.js';

export const socialRouter = Router();

socialRouter.get('/profile', async (req: Request, res: Response) => {
  const ownerId = req.ownerId;
  const user = await findOneItem('users', { id: ownerId });
  const profile = await getUserProfile(ownerId);
  res.json({
    user: user ? { id: user.id, name: user.name, email: user.email } : null,
    profile,
  });
});

socialRouter.get('/profile/:targetUserId', async (req: Request, res: Response) => {
  const { targetUserId } = req.params;
  const user = await findOneItem('users', { id: targetUserId });
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const profile = await getUserProfile(targetUserId);
  const gameStats = await getCollectionItems('gameStats', { ownerId: targetUserId });

  const totalSoloGames = gameStats.reduce((sum, s) => sum + (s.totalPlayed || 0), 0);
  const totalSoloQuestions = gameStats.reduce((sum, s) => sum + (s.totalQuestions || 0), 0);
  const totalSoloCorrect = gameStats.reduce((sum, s) => sum + (s.totalCorrect || 0), 0);
  const bestStreak = gameStats.reduce((max, s) => Math.max(max, s.bestStreak || 0), 0);
  const overallAccuracy = totalSoloQuestions > 0 ? Math.round((totalSoloCorrect / totalSoloQuestions) * 100) : 0;

  const presence = getUserPresence(targetUserId);

  res.json({
    user: {
      id: user.id,
      name: user.name,
      createdAt: user.createdAt,
    },
    profile: {
      xp: profile.xp,
      level: profile.level,
      progressPercent: profile.progressPercent,
      multiplayerWins: profile.multiplayerWins,
      multiplayerPlayed: profile.multiplayerPlayed,
      totalSoloGames,
      bestStreak,
      overallAccuracy,
      presence,
    },
    gameStats,
  });
});

socialRouter.get('/search', async (req: Request, res: Response) => {
  const ownerId = req.ownerId;
  const query = (req.query.q as string || '').trim().toLowerCase();
  if (!query || query.length < 2) {
    res.json([]);
    return;
  }

  const allUsers = await getCollectionItems('users', {});
  const matches = (allUsers || [])
    .filter((u) => u.id !== ownerId && (
      (u.name && u.name.toLowerCase().includes(query)) ||
      (u.email && u.email.toLowerCase().includes(query))
    ))
    .slice(0, 10)
    .map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
    }));

  res.json(matches);
});

socialRouter.get('/friends', async (req: Request, res: Response) => {
  const ownerId = req.ownerId;
  const [listA, listB] = await Promise.all([
    getCollectionItems('friendships', { userA: ownerId }),
    getCollectionItems('friendships', { userB: ownerId }),
  ]);

  const friendshipList = [...listA, ...listB];
  const friendIds = Array.from(new Set(friendshipList.map((f) => (f.userA === ownerId ? f.userB : f.userA))));

  const friends = await Promise.all(
    friendIds.map(async (friendId) => {
      const user = await findOneItem('users', { id: friendId });
      const profile = await getUserProfile(friendId);
      const presence = getUserPresence(friendId);
      return {
        id: friendId,
        name: user?.name || 'Student Friend',
        email: user?.email || '',
        level: profile.level,
        xp: profile.xp,
        multiplayerWins: profile.multiplayerWins,
        presence,
      };
    })
  );

  res.json(friends);
});

socialRouter.get('/requests', async (req: Request, res: Response) => {
  const ownerId = req.ownerId;
  const [incoming, outgoing] = await Promise.all([
    getCollectionItems('friendRequests', { toUserId: ownerId, status: 'pending' }),
    getCollectionItems('friendRequests', { fromUserId: ownerId, status: 'pending' }),
  ]);

  res.json({
    incoming: incoming || [],
    outgoing: outgoing || [],
  });
});

socialRouter.post('/requests', async (req: Request, res: Response) => {
  const ownerId = req.ownerId;
  const { toUserId } = req.body || {};

  if (!toUserId || typeof toUserId !== 'string') {
    res.status(400).json({ error: 'toUserId is required' });
    return;
  }

  if (toUserId === ownerId) {
    res.status(400).json({ error: 'You cannot send a friend request to yourself' });
    return;
  }

  const [targetUser, senderUser] = await Promise.all([
    findOneItem('users', { id: toUserId }),
    findOneItem('users', { id: ownerId }),
  ]);

  if (!targetUser) {
    res.status(404).json({ error: 'Target user does not exist' });
    return;
  }

  const [existingFriendA, existingFriendB] = await Promise.all([
    findOneItem('friendships', { userA: ownerId, userB: toUserId }),
    findOneItem('friendships', { userA: toUserId, userB: ownerId }),
  ]);

  if (existingFriendA || existingFriendB) {
    res.status(400).json({ error: 'You are already friends with this student' });
    return;
  }

  const existingRequest = await findOneItem('friendRequests', {
    fromUserId: ownerId,
    toUserId,
    status: 'pending',
  });

  if (existingRequest) {
    res.status(400).json({ error: 'A friend request is already pending for this user' });
    return;
  }

  const newRequest = {
    id: 'freq_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
    fromUserId: ownerId,
    fromUserName: senderUser?.name || 'Student',
    toUserId,
    toUserName: targetUser?.name || 'Student',
    status: 'pending',
    createdAt: new Date().toISOString(),
  };

  await insertItem('friendRequests', newRequest);
  res.status(201).json(newRequest);
});

socialRouter.post('/requests/:id/accept', async (req: Request, res: Response) => {
  const ownerId = req.ownerId;
  const { id } = req.params;

  const request = await findOneItem('friendRequests', { id, toUserId: ownerId, status: 'pending' });
    if (!request) {
    res.status(404).json({ error: 'Friend request not found or already processed' });
    return;
    }

  await updateItem('friendRequests', id, request.fromUserId, { status: 'accepted', updatedAt: new Date().toISOString() });

  const friendship = {
    id: 'frnd_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
    userA: request.fromUserId,
    userB: request.toUserId,
    createdAt: new Date().toISOString(),
  };

  await insertItem('friendships', friendship);

  res.json({ success: true, friendship });
});

socialRouter.post('/requests/:id/reject', async (req: Request, res: Response) => {
  const ownerId = req.ownerId;
  const { id } = req.params;

  const request = await findOneItem('friendRequests', { id, toUserId: ownerId, status: 'pending' });
  if (!request) {
    res.status(404).json({ error: 'Friend request not found or already processed' });
    return;
  }

  await updateItem('friendRequests', id, request.fromUserId, { status: 'rejected', updatedAt: new Date().toISOString() });
  res.json({ success: true, id });
});

socialRouter.delete('/friends/:friendId', async (req: Request, res: Response) => {
  const ownerId = req.ownerId;
  const { friendId } = req.params;

  const [friendA, friendB] = await Promise.all([
    findOneItem('friendships', { userA: ownerId, userB: friendId }),
    findOneItem('friendships', { userA: friendId, userB: ownerId }),
  ]);

  const target = friendA || friendB;
  if (!target) {
    res.status(404).json({ error: 'Friendship not found' });
    return;
  }

  await deleteItem('friendships', target.id, target.userA);
  res.json({ success: true, friendId });
});

socialRouter.get('/challenges', async (req: Request, res: Response) => {
  const ownerId = req.ownerId;
  const data = await getUserWeeklyChallenges(ownerId);
  res.json(data);
});

socialRouter.post('/challenges/claim', async (req: Request, res: Response) => {
  const ownerId = req.ownerId;
  const { challengeId } = req.body || {};
  if (!challengeId) {
    res.status(400).json({ error: 'challengeId is required' });
    return;
  }

  try {
    const result = await claimWeeklyChallengeReward(ownerId, challengeId);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to claim challenge reward' });
  }
});

socialRouter.get('/stats', async (req: Request, res: Response) => {
  const ownerId = req.ownerId;
  const [profile, gameStats, sessions, pomodoroSessions, tasks] = await Promise.all([
    getUserProfile(ownerId),
    getCollectionItems('gameStats', { ownerId }),
    getCollectionItems('gameSessions', { ownerId }),
    getCollectionItems('pomodoroSessions', { ownerId }),
    getCollectionItems('tasks', { ownerId }),
  ]);

  const totalSoloGames = (sessions || []).length;
  const totalQuestions = (gameStats || []).reduce((sum, s) => sum + (s.totalQuestions || 0), 0);
  const totalCorrect = (gameStats || []).reduce((sum, s) => sum + (s.totalCorrect || 0), 0);
  const bestStreak = (gameStats || []).reduce((max, s) => Math.max(max, s.bestStreak || 0), 0);
  const overallAccuracy = totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : 0;

  const totalFocusMinutes = (pomodoroSessions || []).reduce((sum, p) => sum + (p.durationMinutes || 0), 0);
  const totalTasksCompleted = (tasks || []).filter((t) => t.completed).length;

  const multiplayerPlayed = profile.multiplayerPlayed || 0;
  const multiplayerWins = profile.multiplayerWins || 0;
  const winRate = multiplayerPlayed > 0 ? Math.round((multiplayerWins / multiplayerPlayed) * 100) : 0;

  res.json({
    progression: {
      xp: profile.xp,
      level: profile.level,
      currentLevelXp: profile.currentLevelXp,
      xpRequiredForNext: profile.xpRequiredForNext,
      progressPercent: profile.progressPercent,
    },
    multiplayer: {
      played: multiplayerPlayed,
      wins: multiplayerWins,
      winRate,
    },
    soloGames: {
      totalPlayed: totalSoloGames,
      overallAccuracy,
      bestStreak,
      byGame: gameStats || [],
    },
    productivity: {
      focusMinutes: totalFocusMinutes,
      tasksCompleted: totalTasksCompleted,
    },
  });
});
  