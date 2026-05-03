/* =========================================
   HEART OF TEXAS ORGANICS MAIN JS
   ========================================= */

document.addEventListener('DOMContentLoaded', () => {

  // --- Nav: scroll state ---
  // Only restore nav--transparent on scroll-up if this page started with it (homepage only)
  const nav = document.querySelector('.nav');
  if (nav) {
    const startsTransparent = nav.classList.contains('nav--transparent');
    const updateNav = () => {
      if (window.scrollY > 40) {
        nav.classList.add('scrolled');
        nav.classList.remove('nav--transparent');
      } else {
        nav.classList.remove('scrolled');
        if (startsTransparent) {
          nav.classList.add('nav--transparent');
        }
      }
    };
    updateNav();
    window.addEventListener('scroll', updateNav, { passive: true });
  }

  // --- Mobile menu toggle ---
  const toggle = document.querySelector('.nav__toggle');
  const mobileMenu = document.querySelector('.nav__mobile-menu');
  if (toggle && mobileMenu) {
    toggle.addEventListener('click', () => {
      const isOpen = toggle.classList.toggle('open');
      mobileMenu.classList.toggle('open', isOpen);
      document.body.style.overflow = isOpen ? 'hidden' : '';
    });
    // Close on link click
    mobileMenu.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        toggle.classList.remove('open');
        mobileMenu.classList.remove('open');
        document.body.style.overflow = '';
      });
    });
  }

  // --- Active nav link based on current page ---
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav__link, .nav__mobile-link').forEach(link => {
    const href = link.getAttribute('href');
    if (href === currentPage || (currentPage === '' && href === 'index.html')) {
      link.classList.add('active');
    }
  });

  // --- Fade-in on scroll ---
  const fadeEls = document.querySelectorAll('[data-fade]');
  if ('IntersectionObserver' in window && fadeEls.length) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

    fadeEls.forEach(el => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(24px)';
      el.style.transition = 'opacity 0.7s ease, transform 0.7s ease';
      observer.observe(el);
    });

    document.head.insertAdjacentHTML('beforeend', `
      <style>
        [data-fade].visible { opacity: 1 !important; transform: none !important; }
      </style>
    `);
  }

});
