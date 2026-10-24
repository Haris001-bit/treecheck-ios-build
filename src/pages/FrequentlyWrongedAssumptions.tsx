import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import treecheckLogo from '@/assets/treecheck-logo-dark.png';

const CARDS = [
  {
    assumption: "This is just like Angie\u2019s List.",
    reframe: "We know. That\u2019s exactly why we built something different. Angie\u2019s List sells the same lead to 10, 15, sometimes 20 contractors. You\u2019re bidding against a crowd before you\u2019ve even said hello. TreeCheck caps every lead at 3 contractors. Three. You\u2019re not fighting a mob \u2014 you\u2019re in a short lineup. And unlike Angie\u2019s List, you see the job details and AI estimate before you decide to spend a dime. Angie\u2019s List made contractors hate lead platforms. TreeCheck is the answer to that.",
  },
  {
    assumption: "I\u2019ll be competing against a thousand other contractors.",
    reframe: "You won\u2019t. Three contractors per lead. That\u2019s the rule, that\u2019s the cap, that\u2019s the ceiling. You have a 1-in-3 shot before you\u2019ve even picked up the phone. Do you know what your odds are when a homeowner posts on Nextdoor? Or when they Google \u201Ctree removal near me\u201D and you\u2019re on page 2? TreeCheck puts you in a room with two other people, not a stadium.",
  },
  {
    assumption: "Lowballers are just going to undercut everyone.",
    reframe: "Lowballers exist everywhere \u2014 in your market right now, on every platform, in every neighborhood Facebook group. TreeCheck doesn\u2019t create that problem. What it does do is give you the AI estimate upfront so you can see what the job is actually worth before you decide to compete for it. If the estimate says $1,800 and someone\u2019s going to bid $400, that\u2019s their problem. You\u2019re not locked in. You don\u2019t unlock leads you don\u2019t want.",
  },
  {
    assumption: "The app might have a virus or steal my information.",
    reframe: "TreeCheck AI is a registered business with real investors, real contractor partners, and real accountability. The app collects exactly what it needs to send you leads: your name, your service area, and your contact info. That\u2019s it. If you\u2019ve ever downloaded a weather app, used Google Maps, or ordered food from DoorDash, you\u2019ve shared more personal data than TreeCheck will ever ask for. This concern isn\u2019t about TreeCheck \u2014 it\u2019s about the internet. And you\u2019re already on it.",
  },
  {
    assumption: "I don\u2019t want to pay for leads.",
    reframe: "Then don\u2019t. Seriously. Download the app, turn on notifications, and watch leads come in for your area \u2014 completely free. You don\u2019t pay for anything until you choose to unlock a specific lead. No subscription. No monthly fee. No commitment. You pay for a lead the same way you pay for a vending machine snack: only when you decide you want it. No one is reaching into your pocket.",
  },
  {
    assumption: "I already get enough work from referrals.",
    reframe: "Great. Referrals are the best leads in the business \u2014 nobody\u2019s arguing that. But referrals don\u2019t come in on a schedule. They dry up in slow seasons. They don\u2019t fill a gap week. TreeCheck isn\u2019t a replacement for your referral network. It\u2019s the thing you open on a slow Wednesday when your schedule has a hole in it and you want to find a job that\u2019s close, manageable, and already estimated. It\u2019s a lever you pull when you need it. The app sitting on your phone costs you nothing.",
  },
  {
    assumption: "The leads won\u2019t be quality.",
    reframe: "Every lead in TreeCheck comes with a photo submission and an AI-generated estimate. That means the homeowner had to actually take a picture of their tree, submit it, and wait for a response \u2014 not just type \u201Ctree removal\u201D into a form field. That friction filters out the tire kickers. By the time a lead hits your feed, a real person with a real tree has already invested time in the process. That\u2019s a warmer lead than most platforms ever send you.",
  },
  {
    assumption: "What if I unlock a lead and don\u2019t get the job?",
    reframe: "Then you\u2019ve spent $22 and learned something. That\u2019s less than a tank of gas. But here\u2019s the part contractors miss: because you see the job details and AI estimate before you unlock, you\u2019re not blindly betting. You\u2019re making an informed decision about whether this job is worth pursuing. You control your close rate by being selective. Only unlock leads you actually want to win.",
  },
  {
    assumption: "I don\u2019t trust AI estimates.",
    reframe: "You don\u2019t have to trust them blindly \u2014 you have to use them as a starting point, which is exactly what they are. The AI estimate tells you the ballpark before you unlock. It\u2019s not your final bid. It\u2019s a filter. It tells you whether this job is a $500 shrub trim or a $4,000 technical removal before you spend a dollar. Use it the way you\u2019d use Google Maps \u2014 not as gospel, but as a guide that saves you from driving in the wrong direction.",
  },
  {
    assumption: "I\u2019m too busy to deal with an app.",
    reframe: "The app sends you a notification. You look at it. You swipe if you don\u2019t want it. You unlock if you do. That\u2019s the entire interaction. It takes less time than reading a text from your supplier. If you\u2019re too busy for that, you\u2019re too busy to grow \u2014 and that\u2019s a different conversation entirely.",
  },
  {
    assumption: "The homeowners won\u2019t be serious.",
    reframe: "A homeowner who photographs their tree, uploads it, describes the job, and waits for an AI estimate is not window shopping. Compare that to someone who fills out a web form in 30 seconds just to \u201Csee what it costs.\u201D TreeCheck\u2019s intake process requires actual effort. Effort equals intent. These are people who want the work done.",
  },
  {
    assumption: "What if the lead is too far away?",
    reframe: "You set your service radius. Leads outside that radius don\u2019t show up in your feed. This is not a mystery box. You tell the app where you work, and it only shows you what\u2019s inside that boundary. If something slips through that you don\u2019t want, you just don\u2019t unlock it. You\u2019re in complete control of what you pursue.",
  },
  {
    assumption: "I tried a lead service once and got burned.",
    reframe: "So did almost every contractor reading this. That\u2019s why TreeCheck was built by someone who actually runs a tree company \u2014 not a Silicon Valley developer who\u2019s never held a chainsaw. The entire model was designed around the specific ways lead platforms have historically failed contractors: too many competitors, blind spending, garbage lead quality, and zero transparency. Every feature in TreeCheck exists because a tree service owner got burned by the old way.",
  },
  {
    assumption: "I don\u2019t want my business information out there.",
    reframe: "Your business is already out there. You have a truck with your name on it. You\u2019re on Google. You\u2019ve got a Facebook page. TreeCheck doesn\u2019t publish your profile to homeowners \u2014 it sends you the lead and lets you decide whether to reach out. The homeowner doesn\u2019t see a contractor marketplace. You see the lead. The information flow is in your favor.",
  },
  {
    assumption: "Tech stuff isn\u2019t really my thing.",
    reframe: "Neither is paperwork, but you do invoices. Neither is marketing, but you put your name on a truck. TreeCheck has one screen that matters: the lead feed. There\u2019s a card. There\u2019s a price. There\u2019s a button. If you can order from an app, you can use TreeCheck. And if you still need help, we\u2019ll walk you through setup in about 10 minutes.",
  },
  {
    assumption: "What if I miss the lead before I see it?",
    reframe: "Leads don\u2019t disappear the second they\u2019re posted. And the notification hits your phone the moment a lead drops in your area. But even if you\u2019re on a job \u2014 even if you see it an hour later \u2014 three slots doesn\u2019t mean three people already grabbed it. If you\u2019re the first contractor to unlock in your area, the lead is yours to pursue. Speed matters, but TreeCheck isn\u2019t a race you\u2019ve already lost before you start.",
  },
  {
    assumption: "I don\u2019t need more leads. I have more work than I can handle.",
    reframe: "Perfect time to be selective, then. Download the app, set your service area tight, and only unlock the jobs that are exactly what you want \u2014 big removals, close to home, high estimated value. TreeCheck doesn\u2019t demand your time. It just makes sure that when a great job appears three streets over, you\u2019re one of three people who gets a shot at it instead of finding out about it when your competitor\u2019s truck is parked in front of the house.",
  },
];

const AUTO_ADVANCE_MS = 7000;
const QUOTE_DELAY_MS = 1500;

export default function FrequentlyWrongedAssumptions() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [stage, setStage] = useState<'entering' | 'quote-visible' | 'full-visible' | 'exiting'>('entering');
  const [isPaused, setIsPaused] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (stageTimerRef.current) clearTimeout(stageTimerRef.current);
  }, []);

  const transitionTo = useCallback((index: number) => {
    clearTimers();
    setStage('exiting');
    stageTimerRef.current = setTimeout(() => {
      setCurrentIndex(index);
      setStage('entering');
      stageTimerRef.current = setTimeout(() => {
        setStage('quote-visible');
        stageTimerRef.current = setTimeout(() => {
          setStage('full-visible');
        }, QUOTE_DELAY_MS);
      }, 50);
    }, 400);
  }, [clearTimers]);

  const goNext = useCallback(() => {
    transitionTo((currentIndex + 1) % CARDS.length);
  }, [currentIndex, transitionTo]);

  const goPrev = useCallback(() => {
    transitionTo((currentIndex - 1 + CARDS.length) % CARDS.length);
  }, [currentIndex, transitionTo]);

  const goTo = useCallback((index: number) => {
    if (index !== currentIndex) transitionTo(index);
  }, [currentIndex, transitionTo]);

  // Auto-advance
  useEffect(() => {
    if (isPaused || stage !== 'full-visible') return;
    timerRef.current = setTimeout(goNext, AUTO_ADVANCE_MS);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [isPaused, stage, goNext]);

  // Init first card
  useEffect(() => {
    setStage('entering');
    const t = setTimeout(() => {
      setStage('quote-visible');
      const t2 = setTimeout(() => setStage('full-visible'), QUOTE_DELAY_MS);
      stageTimerRef.current = t2;
    }, 50);
    stageTimerRef.current = t;
    return clearTimers;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleArrow = useCallback((dir: 'prev' | 'next') => {
    setIsPaused(true);
    dir === 'next' ? goNext() : goPrev();
  }, [goNext, goPrev]);

  const card = CARDS[currentIndex];

  const quoteVisible = stage === 'quote-visible' || stage === 'full-visible';
  const reframeVisible = stage === 'full-visible';
  const cardVisible = stage !== 'exiting' && stage !== 'entering';

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <nav className="flex items-center justify-between p-6 max-w-7xl mx-auto w-full">
        <Link to="/" className="flex items-center gap-3">
          <img src={treecheckLogo} alt="TreeCheck Logo" className="h-10 w-auto object-contain" />
        </Link>
        <Link to="/dashboard">
          <Button variant="outline">Sign In</Button>
        </Link>
      </nav>

      {/* Page Content */}
      <main className="flex-1 flex flex-col items-center px-4 sm:px-6 pb-16">
        {/* Title */}
        <div className="max-w-3xl mx-auto text-center pt-12 pb-10 sm:pt-16 sm:pb-14">
          <h1 className="font-display text-4xl sm:text-5xl font-black text-foreground leading-tight">
            Frequently Wronged Assumptions
          </h1>
          <p className="mt-5 text-lg sm:text-xl text-muted-foreground font-light max-w-2xl mx-auto">
            Every contractor who joined said one of these first. Here's what they know now.
          </p>
        </div>

        {/* Carousel */}
        <div
          className="w-full max-w-3xl mx-auto flex-1 flex flex-col"
          onMouseEnter={() => setIsPaused(true)}
          onMouseLeave={() => setIsPaused(false)}
        >
          {/* Card area */}
          <div className="relative flex-1 flex items-start justify-center min-h-[380px] sm:min-h-[340px]">
            {/* Left arrow */}
            <button
              onClick={() => handleArrow('prev')}
              className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-2 sm:-translate-x-6 z-10 w-10 h-10 sm:w-12 sm:h-12 rounded-full border border-border bg-card flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
              aria-label="Previous"
            >
              <ChevronLeft className="w-5 h-5 sm:w-6 sm:h-6" />
            </button>

            {/* Right arrow */}
            <button
              onClick={() => handleArrow('next')}
              className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-2 sm:translate-x-6 z-10 w-10 h-10 sm:w-12 sm:h-12 rounded-full border border-border bg-card flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
              aria-label="Next"
            >
              <ChevronRight className="w-5 h-5 sm:w-6 sm:h-6" />
            </button>

            {/* Card */}
            <div
              className={`w-full mx-10 sm:mx-16 rounded-xl border border-border bg-card p-8 sm:p-12 transition-opacity duration-400 ${
                cardVisible ? 'opacity-100' : 'opacity-0'
              }`}
              style={{ boxShadow: 'var(--shadow-card)' }}
            >
              {/* Assumption quote */}
              <blockquote
                className={`text-xl sm:text-2xl font-black text-foreground text-center leading-snug transition-opacity duration-500 ${
                  quoteVisible ? 'opacity-100' : 'opacity-0'
                }`}
              >
                "{card.assumption}"
              </blockquote>

              {/* Reframe */}
              <div
                className={`mt-8 text-base sm:text-lg font-light text-muted-foreground leading-relaxed transition-opacity duration-700 ${
                  reframeVisible ? 'opacity-100' : 'opacity-0'
                }`}
              >
                {card.reframe}
              </div>
            </div>
          </div>

          {/* Dots */}
          <div className="flex items-center justify-center gap-2 pt-8 pb-4">
            {CARDS.map((_, i) => (
              <button
                key={i}
                onClick={() => { setIsPaused(true); goTo(i); }}
                className={`w-2.5 h-2.5 rounded-full transition-all duration-300 ${
                  i === currentIndex
                    ? 'bg-primary scale-110'
                    : 'bg-border hover:bg-muted-foreground/40'
                }`}
                aria-label={`Go to card ${i + 1}`}
              />
            ))}
          </div>

          {/* Counter */}
          <p className="text-center text-sm text-muted-foreground font-light pb-2">
            {currentIndex + 1} of {CARDS.length}
          </p>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border py-8 px-6">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <img src={treecheckLogo} alt="TreeCheck Logo" className="h-7 w-auto object-contain opacity-60" />
          <p className="text-sm text-muted-foreground font-light">
            TreeCheck AI. Built by a tree company, for tree companies.
          </p>
        </div>
      </footer>
    </div>
  );
}