import React, { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import AddToHomeGuide from '../components/AddToHomeGuide.jsx';
import { useAuth } from '../auth.jsx';

function isSafeReturnPath(value) {
  return typeof value === 'string'
    && value.startsWith('/')
    && !value.startsWith('//')
    && !value.startsWith('/guide/ios-home')
    && !value.startsWith('/add-to-home');
}

export default function AddToHome() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  const closeGuide = useCallback(() => {
    const returnTo = location.state?.returnTo;
    if (isSafeReturnPath(returnTo)) {
      navigate(returnTo, { replace: true });
      return;
    }

    if (!user) {
      navigate('/login', { replace: true });
      return;
    }

    const home = user.role === 'admin' ? '/admin' : user.role === 'teacher' ? '/teacher' : '/';
    navigate(home, { replace: true });
  }, [location.state, navigate, user]);

  return <AddToHomeGuide mode="page" onClose={closeGuide} />;
}
