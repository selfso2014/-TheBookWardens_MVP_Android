/**
 * BookData.js
 * 책 선택 화면에서 사용하는 3권의 메타데이터 + 게임 데이터 통합 파일.
 * v2: Aesop / Sherlock 컨텐츠를 각자의 Content 파일에서 임포트.
 */

// ── Alice (기존 데이터) ────────────────────────────────────────────────────────
import { vocabList as _aliceVocab, midBossQuizzes as _aliceQuizzes, finalBossQuiz as _aliceFinalQuiz } from './QuizData.js?v=20260224-FQ';
import { storyParagraphs as _aliceStory } from './StoryContent.js?v=20260224-FQ';
import { storyChapter1 as _aliceChapter } from './StoryContent_Dynamic.js?v=20260224-FQ';

// ── Aesop (신규) ─────────────────────────────────────────────────────────────
import {
    aesopVocab as _aesopVocab,
    aesopStoryParagraphs as _aesopStory,
    aesopStoryChapter as _aesopChapter,
    aesopMidBossQuizzes as _aesopQuizzes,
    aesopFinalBossQuiz as _aesopFinalQuiz
} from './AesopContent.js?v=20260226-C1';

// ── Sherlock (신규) ───────────────────────────────────────────────────────────
import {
    sherlockVocab as _sherlockVocab,
    sherlockStoryParagraphs as _sherlockStory,
    sherlockStoryChapter as _sherlockChapter,
    sherlockMidBossQuizzes as _sherlockQuizzes,
    sherlockFinalBossQuiz as _sherlockFinalQuiz
} from './SherlockContent.js?v=20260226-C1';

// ── 메인 BOOKS 배열 (export) ──────────────────────────────────────────────────
export const BOOKS = [
    {
        id: "aesop",
        title: "Aesop's Fables",
        subtitle: "Ancient Wisdom, Timeless Lessons",
        image: "./aesopBook.png",
        pages: 124,
        chapters: 10,
        gemCost: 500,
        riftDamage: 1000,
        difficulty: "Easy",
        difficultyStars: 1,
        difficultyColor: "#00dc78",
        accentColor: "#00dc78",
        glowColor: "rgba(0, 220, 120, 0.4)",
        vocabList: _aesopVocab,
        storyParagraphs: _aesopStory,
        storyChapter: _aesopChapter,   // ← 토큰 레벨 데이터 (Typewriter 엔진용)
        midBossQuizzes: _aesopQuizzes,
        finalBossQuiz: _aesopFinalQuiz
    },
    {
        id: "alice",
        title: "Alice's Adventures in Wonderland",
        subtitle: "Down the Rabbit-Hole",
        image: "./aliceBook.png",
        pages: 152,
        chapters: 12,
        gemCost: 1000,
        riftDamage: 2500,
        difficulty: "Normal",
        difficultyStars: 2,
        difficultyColor: "#c084ff",
        accentColor: "#8b2fc9",
        glowColor: "rgba(139, 47, 201, 0.4)",
        vocabList: _aliceVocab,
        storyParagraphs: _aliceStory,
        storyChapter: _aliceChapter,   // ← 토큰 레벨 데이터
        midBossQuizzes: _aliceQuizzes,
        finalBossQuiz: _aliceFinalQuiz
    },
    {
        id: "sherlock",
        title: "The Adventures of Sherlock Holmes",
        subtitle: "The World's Greatest Detective",
        image: "./SherlockBook.png",
        pages: 180,
        chapters: 12,
        gemCost: 1500,
        riftDamage: 3200,
        difficulty: "Hard",
        difficultyStars: 3,
        difficultyColor: "#ff6b6b",
        accentColor: "#cc2200",
        glowColor: "rgba(204, 34, 0, 0.4)",
        vocabList: _sherlockVocab,
        storyParagraphs: _sherlockStory,
        storyChapter: _sherlockChapter, // ← 토큰 레벨 데이터
        midBossQuizzes: _sherlockQuizzes,
        finalBossQuiz: _sherlockFinalQuiz
    }
];
