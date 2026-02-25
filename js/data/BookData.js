/**
 * BookData.js
 * 책 선택 화면에서 사용하는 3권의 메타데이터 + 게임 데이터 통합 파일.
 * Aesop / Sherlock는 vocabList, storyParagraphs, quizzes를 추후 교체할 플레이스홀더로 설정.
 */

// ── Alice 기존 데이터 (QuizData.js + StoryContent.js에서 이동) ─────────────
import { vocabList as _aliceVocab, midBossQuizzes as _aliceQuizzes, finalBossQuiz as _aliceFinalQuiz } from './QuizData.js?v=20260224-FQ';
import { storyParagraphs as _aliceStory } from './StoryContent.js?v=20260224-FQ';

// ── Aesop 플레이스홀더 데이터 ─────────────────────────────────────────────
const _aesopVocab = [
    {
        word: "Cunning",
        sentence: '"The <b>cunning</b> fox tricked the crow into dropping the cheese."',
        options: [
            "A. Slow and clumsy",
            "B. Clever, especially in a deceptive way",
            "C. Kind and generous"
        ],
        answer: 1,
        image: "./rune_peculiar.png"
    },
    {
        word: "Haste",
        sentence: '"Make <b>haste</b> slowly — rushing often leads to mistakes."',
        options: [
            "A. Great speed or urgency",
            "B. Deep sleep",
            "C. Careful planning"
        ],
        answer: 0,
        image: "./rune_vanish.png"
    },
    {
        word: "Persevere",
        sentence: '"The tortoise chose to <b>persevere</b>, one steady step at a time."',
        options: [
            "A. To give up easily",
            "B. To continue despite difficulty",
            "C. To run very fast"
        ],
        answer: 1,
        image: "./rune_luminous.png"
    }
];

const _aesopStory = _aliceStory; // 플레이스홀더 — 추후 Aesop 본문으로 교체

const _aesopMidBossQuizzes = [
    { q: "Why did the tortoise win the race?", o: ["It ran faster at the end.", "It kept a steady pace without stopping.", "The hare got injured."], a: 1 },
    { q: "What lesson does the Fox and the Crow story teach?", o: ["Flattery can lead to foolishness.", "Crows are smarter than foxes.", "Cheese is valuable."], a: 0 },
    { q: "In The Boy Who Cried Wolf, why did no one help the boy?", o: ["They were too far away.", "He had lied so many times before.", "The wolf was too dangerous."], a: 1 }
];

const _aesopFinalQuiz = {
    q: "What is the central moral theme across Aesop's Fables?",
    o: [
        "Actions have consequences, and virtues like honesty and perseverance are rewarded.",
        "Only the strongest animals survive in nature.",
        "Humans are always smarter than animals."
    ],
    a: 0
};

// ── Sherlock 플레이스홀더 데이터 ──────────────────────────────────────────
const _sherlockVocab = [
    {
        word: "Deduction",
        sentence: '"Through careful observation and <b>deduction</b>, Holmes solved the case."',
        options: [
            "A. Wild guessing",
            "B. The process of reasoning to a conclusion",
            "C. A type of disguise"
        ],
        answer: 1,
        image: "./rune_luminous.png"
    },
    {
        word: "Peculiar",
        sentence: '"Watson found Holmes\'s methods most <b>peculiar</b> at first."',
        options: [
            "A. Strange or unusual",
            "B. Common and expected",
            "C. Dangerous"
        ],
        answer: 0,
        image: "./rune_peculiar.png"
    },
    {
        word: "Imminent",
        sentence: '"The danger was <b>imminent</b> — Holmes had minutes to act."',
        options: [
            "A. Already past",
            "B. About to happen very soon",
            "C. Far in the future"
        ],
        answer: 1,
        image: "./rune_vanish.png"
    }
];

const _sherlockStory = _aliceStory; // 플레이스홀더 — 추후 Sherlock 본문으로 교체

const _sherlockMidBossQuizzes = [
    { q: "How does Holmes typically solve his cases?", o: ["By using brute force.", "By careful observation and logical deduction.", "By asking the police for help."], a: 1 },
    { q: "What is Watson's role in the stories?", o: ["He is the main villain.", "He is Holmes's loyal companion and narrator.", "He is a Scotland Yard inspector."], a: 1 },
    { q: "What is Holmes's famous address?", o: ["10 Downing Street", "221B Baker Street", "4 Whitehall Place"], a: 1 }
];

const _sherlockFinalQuiz = {
    q: "What quality most distinguishes Sherlock Holmes from ordinary detectives?",
    o: [
        "His extraordinary strength and physical abilities.",
        "His unique method of systematic observation and logical reasoning.",
        "His connections to the British royal family."
    ],
    a: 1
};

// ── 메인 BOOKS 배열 (export) ──────────────────────────────────────────────
export const BOOKS = [
    {
        id: "aesop",
        title: "Aesop's Fables",
        subtitle: "Ancient Wisdom, Timeless Lessons",
        image: "./aesopBook.png",
        pages: 124,
        chapters: 10,
        gemCost: 1000,
        difficulty: "Easy",
        difficultyStars: 1,
        difficultyColor: "#00dc78",    // green
        accentColor: "#00dc78",
        glowColor: "rgba(0, 220, 120, 0.4)",
        vocabList: _aesopVocab,
        storyParagraphs: _aesopStory,
        midBossQuizzes: _aesopMidBossQuizzes,
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
        difficulty: "Normal",
        difficultyStars: 2,
        difficultyColor: "#c084ff",    // purple
        accentColor: "#8b2fc9",
        glowColor: "rgba(139, 47, 201, 0.4)",
        vocabList: _aliceVocab,
        storyParagraphs: _aliceStory,
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
        gemCost: 1000,
        difficulty: "Hard",
        difficultyStars: 3,
        difficultyColor: "#ff6b6b",    // red
        accentColor: "#cc2200",
        glowColor: "rgba(204, 34, 0, 0.4)",
        vocabList: _sherlockVocab,
        storyParagraphs: _sherlockStory,
        midBossQuizzes: _sherlockMidBossQuizzes,
        finalBossQuiz: _sherlockFinalQuiz
    }
];
