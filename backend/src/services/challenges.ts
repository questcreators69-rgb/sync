import { getCollectionItems, insertItem, findOneItem } from '../db/mongo.js';
import { awardXp } from './progression.js';

export interface WeeklyChallengeDefinition {
  id: string;
  title: string;
  description: string;
  target: number;
  rewardXp: number;
  category: 'pomodoro' | 'tasks' | 'habits' | 'games' | 'multiplayer';
}

const CHALLENGE_POOL: WeeklyChallengeDefinition[] = [
  {
    id: 'pomodoro_focus',
    title: 'Focus Sprint',
    description: 'Complete 4 Pomodoro study blocks this week',
    target: 4,
    rewardXp: 150,
    category: 'pomodoro',
  },
  {
    id: 'task_finisher',
    title: 'Desk Organizer',
    description: 'Check off 6 academic tasks or homework items',
    target: 6,
    rewardXp: 150,
    category: 'tasks',
  },
  {
    id: 'habit_streak',
    title: 'Routine Master',
    description: 'Log 5 completed habit entries this week',
    target: 5,
    rewardXp: 150,
    category: 'habits',
  },
  {
    id: 'solo_games',
    title: 'Cognitive Boost',
    description: 'Play 4 comparison brain game sessions',
    target: 4,
    rewardXp: 150,
    category: 'games',
  },
  {
    id: 'multiplayer_duels',
    title: 'Study Arena Victor',
    description: 'Win 2 real-time multiplayer duels with friends',
    target: 2,
    rewardXp: 200,
    category: 'multiplayer',
  },
];

export function getWeekPeriod(): { weekKey: string; startIso: string; endIso: string } {
  const now = new Date();
  const day = now.getUTCDay();
  const diffToMonday = (day === 0 ? -6 : 1) - day;
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + diffToMonday, 0, 0, 0));
  const sunday = new Date(Date.UTC(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate() + 6, 23, 59, 59));

  const year = monday.getUTCFullYear();
  const oneJan = new Date(Date.UTC(year, 0, 1));
  const numberOfDays = Math.floor((monday.getTime() - oneJan.getTime()) / (24 * 60 * 60 * 1000));
  const weekNumber = Math.ceil((numberOfDays + oneJan.getUTCDay() + 1) / 7);
  const weekKey = `${year}-W${String(weekNumber).padStart(2, '0')}`;

  return {
    weekKey,
    startIso: monday.toISOString(),
    endIso: sunday.toISOString(),
  };
}

export interface UserChallengeStatus extends WeeklyChallengeDefinition {
  progress: number;
  completed: boolean;
  claimed: boolean;
  canClaim: boolean;
}

export async function getUserWeeklyChallenges(ownerId: string): Promise<{
  weekKey: string;
  endIso: string;
  challenges: UserChallengeStatus[];
}> {
  const { weekKey, startIso, endIso } = getWeekPeriod();

  const [pomodoros, tasks, habitEntries, gameSessions, profile, claims] = await Promise.all([
    getCollectionItems('pomodoroSessions', { ownerId }),
    getCollectionItems('tasks', { ownerId }),
    getCollectionItems('habitEntries', { ownerId }),
    getCollectionItems('gameSessions', { ownerId }),
    findOneItem('userProfiles', { ownerId }),
    getCollectionItems('challengeClaims', { ownerId, weekKey }),
  ]);

  const weekPomodoros = (pomodoros || []).filter(
    (p) => p.completedAt && p.completedAt >= startIso
  ).length;

  const weekTasks = (tasks || []).filter(
    (t) => t.completed && t.updatedAt && t.updatedAt >= startIso
  ).length;

  const weekHabits = (habitEntries || []).filter(
    (h) => h.completed && (h.updatedAt >= startIso || h.date >= startIso.split('T')[0])
  ).length;

  const weekGames = (gameSessions || []).filter(
    (g) => g.playedAt && g.playedAt >= startIso
  ).length;

  const claimedMap = new Set((claims || []).map((c) => c.challengeId));

  const challenges: UserChallengeStatus[] = CHALLENGE_POOL.map((def) => {
    let currentVal = 0;
    if (def.category === 'pomodoro') currentVal = weekPomodoros;
    else if (def.category === 'tasks') currentVal = weekTasks;
    else if (def.category === 'habits') currentVal = weekHabits;
    else if (def.category === 'games') currentVal = weekGames;
    else if (def.category === 'multiplayer') currentVal = profile?.multiplayerWins || 0;

    const progress = Math.min(def.target, currentVal);
    const completed = currentVal >= def.target;
    const claimed = claimedMap.has(def.id);
    const canClaim = completed && !claimed;

    return {
      ...def,
      progress,
      completed,
      claimed,
      canClaim,
    };
  });

  return {
    weekKey,
    endIso,
    challenges,
  };
}

export async function claimWeeklyChallengeReward(
  ownerId: string,
  challengeId: string
): Promise<{ success: boolean; xpAwarded: number; challenge: UserChallengeStatus }> {
  const { weekKey } = getWeekPeriod();
  const status = await getUserWeeklyChallenges(ownerId);
  const challenge = status.challenges.find((c) => c.id === challengeId);

  if (!challenge) {
    throw new Error('Challenge not found');
  }

  if (!challenge.completed) {
    throw new Error('Challenge criteria not yet fulfilled');
  }

  if (challenge.claimed) {
    throw new Error('Challenge reward already claimed');
  }

  const claimRecord = {
    id: 'claim_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
    ownerId,
    weekKey,
    challengeId,
    claimedAt: new Date().toISOString(),
  };

  await insertItem('challengeClaims', claimRecord);
  await awardXp(ownerId, challenge.rewardXp, `Weekly Challenge: ${challenge.title}`);

  return {
    success: true,
    xpAwarded: challenge.rewardXp,
    challenge: {
      ...challenge,
      claimed: true,
      canClaim: false,
    },
  };
}