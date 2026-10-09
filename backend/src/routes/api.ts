import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import {
  getCollectionItems,
  insertItem,
  updateItem,
  deleteItem,
  upsertItem,
  isDbConnected,
} from '../db/mongo.js';
import { authRouter } from './auth.js';
import { socialRouter } from './social.js';
import { awardXp, XP_VALUES } from '../services/progression.js';

declare global {
  namespace Express {
    interface Request {
      ownerId: string;
    }
  }
}

export const apiRouter = Router();

apiRouter.use('/auth', authRouter);

apiRouter.use((req: Request, _res: Response, next) => {
  const headerOwner = req.headers['x-owner-id'] as string;
  const queryOwner = req.query.ownerId as string;
  const bodyOwner = req.body?.ownerId;
  req.ownerId = headerOwner || queryOwner || bodyOwner || 'student-local';
  next();
});

apiRouter.use('/social', socialRouter);

apiRouter.get('/health', async (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    mongoConnected: isDbConnected(),
    timestamp: new Date().toISOString(),
  });
});

apiRouter.get('/tasks', async (req: Request, res: Response) => {
  const ownerId = req.ownerId;
  const tasks = await getCollectionItems('tasks', { ownerId });
  res.json(tasks);
});

apiRouter.post('/tasks', async (req: Request, res: Response) => {
  const ownerId = req.ownerId;
  const { title, description = '', dueDate = '', priority = 'Medium' } = req.body;
  if (!title || typeof title !== 'string' || !title.trim()) {
    res.status(400).json({ error: 'Task title is required' });
    return;
  }
  const task = {
    id: 'task_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
    ownerId,
    title: title.trim(),
    description: description.trim(),
    dueDate,
    priority,
    completed: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await insertItem('tasks', task);
  res.status(201).json(task);
});

apiRouter.patch('/tasks/:id', async (req: Request, res: Response) => {
  const ownerId = req.ownerId;
  const { id } = req.params;
  const allowed = ['title', 'description', 'dueDate', 'priority', 'completed'];
  const updates: Record<string, any> = { updatedAt: new Date().toISOString() };
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      updates[key] = req.body[key];
    }
  }
  const updated = await updateItem('tasks', id, ownerId, updates);
  if (!updated) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  if (updates.completed === true) {
    await awardXp(ownerId, XP_VALUES.TASK_COMPLETED, 'Task Completed');
  }
  res.json(updated);
});

apiRouter.delete('/tasks/:id', async (req: Request, res: Response) => {
  const ownerId = req.ownerId;
  const { id } = req.params;
  const success = await deleteItem('tasks', id, ownerId);
  if (!success) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  res.json({ success: true, id });
});

apiRouter.get('/schedule', async (req: Request, res: Response) => {
  const ownerId = req.ownerId;
  const events = await getCollectionItems('scheduleEvents', { ownerId });
  res.json(events);
});

apiRouter.post('/schedule', async (req: Request, res: Response) => {
  const ownerId = req.ownerId;
  const { title, startTime, endTime, location = '', description = '', category = 'Study', date } = req.body;
  if (!title || !startTime || !endTime) {
    res.status(400).json({ error: 'Title, startTime and endTime are required' });
    return;
  }
  const event = {
    id: 'sched_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
    ownerId,
    title: title.trim(),
    startTime,
    endTime,
    location: location.trim(),
    description: description.trim(),
    category,
    date: date || new Date().toISOString().split('T')[0],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await insertItem('scheduleEvents', event);
  res.status(201).json(event);
});

apiRouter.patch('/schedule/:id', async (req: Request, res: Response) => {
  const ownerId = req.ownerId;
  const { id } = req.params;
  const allowed = ['title', 'startTime', 'endTime', 'location', 'description', 'category', 'date'];
  const updates: Record<string, any> = { updatedAt: new Date().toISOString() };
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      updates[key] = req.body[key];
    }
  }
  const updated = await updateItem('scheduleEvents', id, ownerId, updates);
  if (!updated) {
    res.status(404).json({ error: 'Schedule event not found' });
    return;
  }
  res.json(updated);
});

apiRouter.delete('/schedule/:id', async (req: Request, res: Response) => {
  const ownerId = req.ownerId;
  const { id } = req.params;
  const success = await deleteItem('scheduleEvents', id, ownerId);
  if (!success) {
    res.status(404).json({ error: 'Schedule event not found' });
    return;
  }
  res.json({ success: true, id });
});

apiRouter.get('/timetable', async (req: Request, res: Response) => {
  const ownerId = req.ownerId;
  const entries = await getCollectionItems('timetableEntries', { ownerId });
  res.json(entries);
});

apiRouter.post('/timetable', async (req: Request, res: Response) => {
  const ownerId = req.ownerId;
  const { subject, startTime, endTime, location = '', dayOfWeek, color = 'lavender' } = req.body;
  if (!subject || !startTime || !endTime || !dayOfWeek) {
    res.status(400).json({ error: 'Subject, startTime, endTime, and dayOfWeek are required' });
    return;
  }
  const entry = {
    id: 'tt_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
    ownerId,
    subject: subject.trim(),
    startTime,
    endTime,
    location: location.trim(),
    dayOfWeek,
    color,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await insertItem('timetableEntries', entry);
  res.status(201).json(entry);
});

apiRouter.patch('/timetable/:id', async (req: Request, res: Response) => {
  const ownerId = req.ownerId;
  const { id } = req.params;
  const allowed = ['subject', 'startTime', 'endTime', 'location', 'dayOfWeek', 'color'];
  const updates: Record<string, any> = { updatedAt: new Date().toISOString() };
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      updates[key] = req.body[key];
    }
  }
  const updated = await updateItem('timetableEntries', id, ownerId, updates);
  if (!updated) {
    res.status(404).json({ error: 'Timetable entry not found' });
    return;
  }
  res.json(updated);
});

apiRouter.delete('/timetable/:id', async (req: Request, res: Response) => {
  const ownerId = req.ownerId;
  const { id } = req.params;
  const success = await deleteItem('timetableEntries', id, ownerId);
  if (!success) {
    res.status(404).json({ error: 'Timetable entry not found' });
    return;
  }
  res.json({ success: true, id });
});

apiRouter.get('/habits', async (req: Request, res: Response) => {
  const ownerId = req.ownerId;
  const habits = await getCollectionItems('habits', { ownerId });
  res.json(habits);
});

apiRouter.post('/habits', async (req: Request, res: Response) => {
  const ownerId = req.ownerId;
  const { name, description = '', frequency = 'Daily' } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'Habit name is required' });
    return;
  }
  const habit = {
    id: 'habit_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
    ownerId,
    name: name.trim(),
    description: description.trim(),
    frequency,
    active: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await insertItem('habits', habit);
  res.status(201).json(habit);
});

apiRouter.patch('/habits/:id', async (req: Request, res: Response) => {
  const ownerId = req.ownerId;
  const { id } = req.params;
  const allowed = ['name', 'description', 'frequency', 'active'];
  const updates: Record<string, any> = { updatedAt: new Date().toISOString() };
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      updates[key] = req.body[key];
    }
  }
  const updated = await updateItem('habits', id, ownerId, updates);
  if (!updated) {
    res.status(404).json({ error: 'Habit not found' });
    return;
  }
  res.json(updated);
});

apiRouter.delete('/habits/:id', async (req: Request, res: Response) => {
  const ownerId = req.ownerId;
  const { id } = req.params;
  const success = await deleteItem('habits', id, ownerId);
  if (!success) {
    res.status(404).json({ error: 'Habit not found' });
    return;
  }
  res.json({ success: true, id });
});

apiRouter.get('/habits/entries', async (req: Request, res: Response) => {
  const ownerId = req.ownerId;
  const entries = await getCollectionItems('habitEntries', { ownerId });
  res.json(entries);
});

apiRouter.post('/habits/entries', async (req: Request, res: Response) => {
  const ownerId = req.ownerId;
  const { habitId, date, completed } = req.body;
  if (!habitId || !date) {
    res.status(400).json({ error: 'habitId and date are required' });
    return;
  }
  const entryId = 'he_' + habitId + '_' + date;
  const entry = {
    id: entryId,
    ownerId,
    habitId,
    date,
    completed: Boolean(completed),
    updatedAt: new Date().toISOString(),
  };
  await upsertItem('habitEntries', { id: entryId, ownerId }, entry);
  if (entry.completed) {
    await awardXp(ownerId, XP_VALUES.HABIT_COMPLETED, 'Habit Completed');
  }
  res.json(entry);
});

apiRouter.get('/exams', async (req: Request, res: Response) => {
  const ownerId = req.ownerId;
  const exams = await getCollectionItems('exams', { ownerId });
  res.json(exams);
});

apiRouter.post('/exams', async (req: Request, res: Response) => {
  const ownerId = req.ownerId;
  const { subject, examDate, time = '', location = '', description = '' } = req.body;
  if (!subject || !examDate) {
    res.status(400).json({ error: 'Subject and examDate are required' });
    return;
  }
  const exam = {
    id: 'exam_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
    ownerId,
    subject: subject.trim(),
    examDate,
    time: time.trim(),
    location: location.trim(),
    description: description.trim(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await insertItem('exams', exam);
  res.status(201).json(exam);
});

apiRouter.patch('/exams/:id', async (req: Request, res: Response) => {
  const ownerId = req.ownerId;
  const { id } = req.params;
  const allowed = ['subject', 'examDate', 'time', 'location', 'description'];
  const updates: Record<string, any> = { updatedAt: new Date().toISOString() };
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      updates[key] = req.body[key];
    }
  }
  const updated = await updateItem('exams', id, ownerId, updates);
  if (!updated) {
    res.status(404).json({ error: 'Exam not found' });
    return;
  }
  res.json(updated);
});

apiRouter.delete('/exams/:id', async (req: Request, res: Response) => {
  const ownerId = req.ownerId;
  const { id } = req.params;
  const success = await deleteItem('exams', id, ownerId);
  if (!success) {
    res.status(404).json({ error: 'Exam not found' });
    return;
  }
  res.json({ success: true, id });
});

apiRouter.get('/notes', async (req: Request, res: Response) => {
  const ownerId = req.ownerId;
  const notes = await getCollectionItems('notes', { ownerId });
  res.json(notes);
});

apiRouter.post('/notes', async (req: Request, res: Response) => {
  const ownerId = req.ownerId;
  const { title, content } = req.body;
  if (!title || !title.trim()) {
    res.status(400).json({ error: 'Note title is required' });
    return;
  }
  const note = {
    id: 'note_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
    ownerId,
    title: title.trim(),
    content: (content || '').trim(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await insertItem('notes', note);
  res.status(201).json(note);
});

apiRouter.patch('/notes/:id', async (req: Request, res: Response) => {
  const ownerId = req.ownerId;
  const { id } = req.params;
  const allowed = ['title', 'content'];
  const updates: Record<string, any> = { updatedAt: new Date().toISOString() };
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      updates[key] = req.body[key];
    }
  }
  const updated = await updateItem('notes', id, ownerId, updates);
  if (!updated) {
    res.status(404).json({ error: 'Note not found' });
    return;
  }
  res.json(updated);
});

apiRouter.delete('/notes/:id', async (req: Request, res: Response) => {
  const ownerId = req.ownerId;
  const { id } = req.params;
  const success = await deleteItem('notes', id, ownerId);
  if (!success) {
    res.status(404).json({ error: 'Note not found' });
    return;
  }
  res.json({ success: true, id });
});

apiRouter.get('/projects', async (req: Request, res: Response) => {
  const ownerId = req.ownerId;
  const projects = await getCollectionItems('projects', { ownerId });
  res.json(projects);
});

apiRouter.post('/projects', async (req: Request, res: Response) => {
  const ownerId = req.ownerId;
  const { title, description = '' } = req.body;
  if (!title || !title.trim()) {
    res.status(400).json({ error: 'Project title is required' });
    return;
  }
  const project = {
    id: 'proj_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
    ownerId,
    title: title.trim(),
    description: description.trim(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await insertItem('projects', project);
  res.status(201).json(project);
});

apiRouter.patch('/projects/:id', async (req: Request, res: Response) => {
  const ownerId = req.ownerId;
  const { id } = req.params;
  const allowed = ['title', 'description'];
  const updates: Record<string, any> = { updatedAt: new Date().toISOString() };
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      updates[key] = req.body[key];
    }
  }
  const updated = await updateItem('projects', id, ownerId, updates);
  if (!updated) {
    res.status(404).json({ error: 'Project not found' });
    return;  
  }
  res.json(updated);
});

apiRouter.delete('/projects/:id', async (req: Request, res: Response) => {
  const ownerId = req.ownerId;
  const { id } = req.params;
  const success = await deleteItem('projects', id, ownerId);
  if (!success) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  res.json({ success: true, id });
});

apiRouter.get('/pomodoro', async (req: Request, res: Response) => {
  const ownerId = req.ownerId;
  const sessions = await getCollectionItems('pomodoroSessions', { ownerId });
  res.json(sessions);
});

apiRouter.post('/pomodoro', async (req: Request, res: Response) => {
  const ownerId = req.ownerId;
  const { durationMinutes, type = 'focus' } = req.body;
  const session = {
    id: 'pomo_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
    ownerId,
    durationMinutes: Number(durationMinutes) || 25,
    type,
    completedAt: new Date().toISOString(),
  };
  await insertItem('pomodoroSessions', session);
  await awardXp(ownerId, XP_VALUES.POMODORO_COMPLETED, 'Pomodoro Focus Session');
  res.status(201).json(session);
});

apiRouter.get('/games/dataset/:gameId', async (req: Request, res: Response) => {
  const { gameId } = req.params;
  const validGames: Record<string, string> = {
    scaleshift: 'scaleshift.json',
    priceshock: 'priceshock.json',
    statclash: 'statclash.json',
    distanceduel: 'distanceduel.json',
  };
  const filename = validGames[gameId.toLowerCase()];
  if (!filename) {
    res.status(404).json({ error: 'Unknown game dataset' });
    return;
  }
  try {
    const localDataPath = path.resolve(process.cwd(), 'data', filename);
    const rootDataPath = path.resolve(process.cwd(), 'backend', 'data', filename);
    const filePath = fs.existsSync(localDataPath) ? localDataPath : rootDataPath;
    const content = fs.readFileSync(filePath, 'utf-8');
    const items = JSON.parse(content);
    res.json(items);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to load game dataset', details: err?.message });
  }
});

apiRouter.get('/games/stats', async (req: Request, res: Response) => {
  const ownerId = req.ownerId;
  const stats = await getCollectionItems('gameStats', { ownerId });
  res.json(stats);
});

apiRouter.post('/games/session', async (req: Request, res: Response) => {
  const ownerId = req.ownerId;
  const { gameId, finalStreak, score, questionsAnswered, correctAnswers, accuracy } = req.body;
  if (!gameId) {
    res.status(400).json({ error: 'gameId is required' });
    return;
  }
  const session = {
    id: 'gsess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
    ownerId,
    gameId,
    finalStreak: Number(finalStreak) || 0,
    score: Number(score) || 0,
    questionsAnswered: Number(questionsAnswered) || 0,
    correctAnswers: Number(correctAnswers) || 0,
    accuracy: Number(accuracy) || 0,
    playedAt: new Date().toISOString(),
  };
  await insertItem('gameSessions', session);

  const existingStats = await getCollectionItems('gameStats', { ownerId, gameId });
  const current = existingStats[0] || {
    id: 'gstat_' + gameId + '_' + ownerId,
    ownerId,
    gameId,
    bestStreak: 0,
    totalPlayed: 0,
    totalCorrect: 0,
    totalQuestions: 0,
    accuracy: 0,
  };

  const updatedBestStreak = Math.max(current.bestStreak, session.finalStreak);
  const updatedTotalPlayed = (current.totalPlayed || 0) + 1;
  const updatedTotalCorrect = (current.totalCorrect || 0) + session.correctAnswers;
  const updatedTotalQuestions = (current.totalQuestions || 0) + session.questionsAnswered;
  const updatedAccuracy = updatedTotalQuestions > 0 ? Math.round((updatedTotalCorrect / updatedTotalQuestions) * 100) : 0;

  const statRecord = {
    id: current.id,
    ownerId,
    gameId,
    bestStreak: updatedBestStreak,
    totalPlayed: updatedTotalPlayed,
    totalCorrect: updatedTotalCorrect,
    totalQuestions: updatedTotalQuestions,
    accuracy: updatedAccuracy,
    updatedAt: new Date().toISOString(),
  };
  await upsertItem('gameStats', { ownerId, gameId }, statRecord);

  const xpGained = XP_VALUES.GAME_SOLO + (session.finalStreak >= 5 ? XP_VALUES.GAME_SOLO_STREAK_BONUS : 0);
  const xpResult = await awardXp(ownerId, xpGained, `Comparison Game: ${gameId}`);

  res.status(201).json({ session, stats: statRecord, xpResult });
});

apiRouter.get('/dashboard', async (req: Request, res: Response) => {
  const ownerId = req.ownerId;
  const todayStr = new Date().toISOString().split('T')[0];

  const [tasks, scheduleEvents, habits, habitEntries, exams, pomodoroSessions, notes, projects] = await Promise.all([
    getCollectionItems('tasks', { ownerId }),
    getCollectionItems('scheduleEvents', { ownerId }),
    getCollectionItems('habits', { ownerId }),
    getCollectionItems('habitEntries', { ownerId }),
    getCollectionItems('exams', { ownerId }),
    getCollectionItems('pomodoroSessions', { ownerId }),
    getCollectionItems('notes', { ownerId }),
    getCollectionItems('projects', { ownerId }),
  ]);

  const tasksCompletedToday = tasks.filter(t => t.completed && t.updatedAt && t.updatedAt.startsWith(todayStr)).length;
  const tasksRemaining = tasks.filter(t => !t.completed).length;

  const todayPomodoroMinutes = pomodoroSessions
    .filter(p => p.completedAt && p.completedAt.startsWith(todayStr))
    .reduce((sum, p) => sum + (p.durationMinutes || 0), 0);

  const activeHabits = habits.filter(h => h.active !== false);
  let totalHabitStreak = 0;
  for (const h of activeHabits) {
    const entries = habitEntries.filter(e => e.habitId === h.id && e.completed);
    if (entries.length > 0) {
      totalHabitStreak += 1;
    }
  }

  const upcomingExams = exams
    .filter(e => e.examDate >= todayStr)
    .sort((a, b) => a.examDate.localeCompare(b.examDate));
  const nearestExam = upcomingExams[0] || null;

  const todaySchedule = scheduleEvents
    .filter(s => !s.date || s.date === todayStr)
    .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));

  res.json({
    summary: {
      tasksCompletedToday,
      tasksRemaining,
      todayStudyMinutes: todayPomodoroMinutes,
      activeHabitStreak: totalHabitStreak,
      totalHabits: activeHabits.length,
      nearestExam,
    },
    todaySchedule,
    recentNotes: notes.slice(-4).reverse(),
    projects: projects.slice(-4).reverse(),
    upcomingExams: upcomingExams.slice(0, 3),
  });
});
