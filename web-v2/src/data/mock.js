// Hardcoded mock data — no Firestore.
export const MOCK_ENTRIES = [
    {
        id: 'mock_2026-05-02_morning',
        date: '2026-05-02',
        mode: 'morning',
        contentJp: '今日は家族でフラワーパークに行く！いよいよゴールデンウィーク開始！',
        userTranslation: "I'm heading to a flower park with my family today! Anyway, today marks the start of Golden Week!",
        feedback: [
            {
                original: 'Anyway, today marks the start of Golden Week!',
                corrected: "And today is the start of Golden Week — finally!",
                explanation: '"Anyway" は話題を変える時に使う。前文と文脈が続いているので "And ... finally" の方がワクワク感が伝わります。',
            },
        ],
        vocabulary: [
            { word: 'head to', definition: '〜へ向かう', example: "I'm heading to the supermarket to buy some dinner." },
            { word: 'mark the start of', definition: '〜の始まりを告げる、〜が始まる', example: 'Today marks the start of our summer vacation.' },
        ],
        expansionQuestions: [],
        createdAt: Date.now(),
    },
    {
        id: 'mock_2026-05-01_diary',
        date: '2026-05-01',
        mode: 'diary',
        contentJp: '今日は祝日でお休み。イベントはゆずなさん一家の来訪。子どもたちもう小2と年長か。昼はロピア。ちょっと食べすぎた。',
        userTranslation: "Today was a holiday. Yuzuna's family came over. Their kids are already in 2nd grade and kindergarten. We had lunch at Lopia. I ate a bit too much.",
        feedback: [],
        vocabulary: [
            { word: 'come over', definition: '（家に）遊びに来る', example: 'A friend of mine came over for dinner.' },
            { word: 'a bit too much', definition: 'ちょっと多すぎ', example: 'I drank a bit too much last night.' },
        ],
        expansionQuestions: [
            {
                question: 'Why did you eat a bit too much at Lopia?',
                hintJa: '何が美味しかった？量が多かった？',
                hintPhrases: ['the portions were huge', "I couldn't resist"],
            },
        ],
        createdAt: Date.now() - 86400000,
    },
    {
        id: 'mock_2026-04-30_lesson',
        date: '2026-04-30',
        mode: 'lesson',
        contentJp: 'レッスンでは新しい先生と話した。発音を直してくれたのが嬉しかった。次回は冠詞を意識する。',
        userTranslation: "I talked with a new teacher in my lesson. I was happy that she fixed my pronunciation. Next time I'll be conscious about articles.",
        feedback: [
            {
                original: "Next time I'll be conscious about articles.",
                corrected: "Next time I'll pay more attention to articles.",
                explanation: '"be conscious about" は不自然。"pay attention to" の方が自然な英語です。',
            },
        ],
        vocabulary: [
            { word: 'pay attention to', definition: '〜に気をつける、注意を払う', example: 'I need to pay attention to my spelling.' },
        ],
        expansionQuestions: [],
        createdAt: Date.now() - 86400000 * 2,
    },
    {
        id: 'mock_2026-04-29_diary',
        date: '2026-04-29',
        mode: 'diary',
        contentJp: '昨日のレッスン後、復習しようと思ったけど結局YouTube見て寝た。明日からはちゃんとやろう。',
        userTranslation: 'After yesterday\'s lesson I wanted to review, but I ended up watching YouTube and went to sleep. From tomorrow I\'ll do it properly.',
        feedback: [],
        vocabulary: [
            { word: 'end up doing', definition: '結局〜する羽目になる', example: 'I ended up working until midnight.' },
        ],
        expansionQuestions: [],
        createdAt: Date.now() - 86400000 * 3,
    },
    {
        id: 'mock_2026-04-28_morning',
        date: '2026-04-28',
        mode: 'morning',
        contentJp: '今日は午後にレッスン。午前中は集中して仕事を片付ける。',
        userTranslation: "I have a lesson this afternoon. I'll focus and get my work done this morning.",
        feedback: [],
        vocabulary: [
            { word: 'get something done', definition: '〜を済ませる、片付ける', example: 'I want to get this report done before lunch.' },
        ],
        expansionQuestions: [],
        createdAt: Date.now() - 86400000 * 4,
    },
];
export function findEntry(id) {
    return MOCK_ENTRIES.find((e) => e.id === id);
}
export const MODE_META = {
    morning: { label: 'Morning', emoji: '🌅', color: '#e9a450' },
    lesson: { label: 'Lesson', emoji: '🎓', color: '#5b8def' },
    diary: { label: 'Diary', emoji: '🌙', color: '#3a4a6b' },
};
