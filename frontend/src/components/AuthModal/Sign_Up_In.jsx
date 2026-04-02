import React, { useState } from 'react';
import AuthModal from './AuthModal';

export default function Sign_Up_In({ onSuccess }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} style={{ display: 'none' }}>Open Auth</button>
      {open && (
        <AuthModal
          onClose={() => setOpen(false)}
          onSuccess={(name) => {
            onSuccess?.(name);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

