import React, { useEffect } from 'react';
import { Joyride, STATUS, ACTIONS } from 'react-joyride';
import { useTutorialStore } from '../../store';
import { useAuthStore } from '../../store';

// Keep tour styling aligned with the app's dark terminal palette.
const TOUR_COLORS = {
  surface: 'rgba(8, 8, 8, 0.94)',
  surfaceRaised: 'rgba(14, 14, 14, 0.80)',
  backdropFilter: 'blur(12px)',
  border: 'rgba(90, 242, 181, 0.25)',
  text: '#f0f2fc',
  muted: '#9aa3bf',
  accent: '#5AF2B5',
  accentText: '#061510',
  overlay: 'rgba(0, 0, 0, 0.72)',
};

const TOUR_STEPS = [
  {
    target: 'body',
    placement: 'center',
    title: 'Welcome to Synthetic Bull!',
    content: 'Let us take a quick tour to show you where everything is. You can replay this anytime by clicking the Help icon in the header.',
    disableBeacon: true,
  },
  {
    target: '#tour-market-watch',
    title: 'Market Watch',
    content: 'Here you can see the latest prices. Click the Pin icon to keep a stock at the top, or click the Plus icon to compare it against your main chart.',
    placement: 'left',
  },
  {
    target: '#tour-stats-bar',
    title: 'Active Symbol Stats',
    content: 'This bar shows the live 24-hour statistics for whichever asset you are currently trading.',
    placement: 'bottom',
  },
  {
    target: '#tour-order-book',
    title: 'Live Order Book',
    content: 'Track market depth in real time here. You can scroll down to see the full depth of standard Bids and Asks.',
    placement: 'right',
  },
  {
    target: '#tour-place-order',
    title: 'Place Orders',
    content: 'When you are ready, you can configure your Limit or Market orders here to enter the market!',
    placement: 'left',
  }
];

const TutorialTour = () => {
  const { userId } = useAuthStore();
  const { runTutorial, tourKey, stopTutorial } = useTutorialStore();


  useEffect(() => {
    // Slight delay to ensure DOM id nodes are fully painted before Joyride parses them.
    // Use a per-user key so every new user sees the tutorial on first login,
    // but returning users are never shown it again.
    // Write the flag BEFORE starting so a mid-tour browser-close doesn't reset it.
    const timer = setTimeout(() => {
      if (!userId) return; // not logged in yet — wait
      const userKey = `tutorial_seen_${userId}`;
      const hasSeenTutorial = localStorage.getItem(userKey);
      if (!hasSeenTutorial) {
        localStorage.setItem(userKey, 'true');
        useTutorialStore.getState().startTutorial();
      }
    }, 500);
    return () => {
      clearTimeout(timer);
      // Reset the store when navigating away so the tour doesn't auto-resume on remount
      useTutorialStore.getState().stopTutorial();
    };
  }, [userId]); // re-run if userId changes (e.g. after login)

  const handleJoyrideCallback = (data) => {
    const { status, action } = data;

    // Stop the tour UI on any terminal action (finish, skip, or X button).
    const isDone =
      status === STATUS.FINISHED ||
      status === STATUS.SKIPPED ||
      action === ACTIONS.CLOSE;

    if (isDone) {
      stopTutorial();
    }
  };

  return (
    <>
      {runTutorial && (
        <Joyride
          key={tourKey}
          callback={handleJoyrideCallback}
          continuous
          run={runTutorial}
          scrollToFirstStep={false}
          disableScrolling={true}
          showProgress
          showSkipButton
          steps={TOUR_STEPS}
          locale={{
            last: 'Got it!',
            skip: 'Skip Tour',
            close: 'Close',
          }}
          styles={{
            options: {
              zIndex: 10000,
              primaryColor: TOUR_COLORS.accent,
              backgroundColor: TOUR_COLORS.surfaceRaised,
              textColor: TOUR_COLORS.text,
              overlayColor: TOUR_COLORS.overlay,
              arrowColor: TOUR_COLORS.surfaceRaised,
              width: Math.min(380, window.innerWidth - 32),
            },
            tooltip: {
              borderRadius: '10px',
              border: `1px solid ${TOUR_COLORS.border}`,
              backgroundColor: TOUR_COLORS.surfaceRaised,
              backdropFilter: 'blur(10px)',
              WebkitBackdropFilter: 'blur(10px)',
              boxShadow: '0 12px 36px rgba(0, 0, 0, 0.5), inset 0 0 20px rgba(90, 242, 181, 0.04)',
              padding: '20px',
              maxWidth: `${window.innerWidth - 32}px`,
              boxSizing: 'border-box',
            },
            tooltipContainer: {
              textAlign: 'left',
              lineHeight: '1.5',
              color: TOUR_COLORS.text,
            },
            tooltipTitle: {
              color: TOUR_COLORS.accent,
              fontWeight: 700,
              letterSpacing: '0.02em',
              marginBottom: '8px',
            },
            // X close button — make it clearly visible
            buttonClose: {
              color: TOUR_COLORS.muted,
              width: 24,
              height: 24,
              padding: 0,
              top: 12,
              right: 12,
              opacity: 1,
            },
            buttonNext: {
              background: `linear-gradient(90deg, #5AF2B5, #38d49a)`,
              border: 'none',
              borderRadius: '6px',
              color: TOUR_COLORS.accentText,
              fontWeight: 700,
              padding: '8px 16px',
            },
            buttonBack: {
              backgroundColor: 'transparent',
              color: TOUR_COLORS.muted,
              marginRight: '10px',
            },
            buttonSkip: {
              backgroundColor: 'transparent',
              color: TOUR_COLORS.muted,
            },
          }}
        />
      )}
    </>
  );
};

export default TutorialTour;
