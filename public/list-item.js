// public/js/list-item.js
// Add this to list-item.html to handle form submission and redirect.
// Assumes your form has id="item-form" and your file inputs are named "images" and "video"

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('item-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const submitBtn = form.querySelector('button[type="submit"]');
    const errorEl = document.getElementById('form-error');
    if (errorEl) errorEl.textContent = '';

    // Disable button to prevent double submit
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Uploading…';
    }

    try {
      const formData = new FormData(form);

      const res = await fetch('http://localhost:5000/api/items/create', {
        method: 'POST',
        body: formData,
        // Do NOT set Content-Type — let browser set multipart boundary
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Upload failed');
      }

      // ✅ SUCCESS — redirect to success page
      window.location.href = '/item-uploaded.html';

    } catch (err) {
      console.error('Submit error:', err);

      if (errorEl) {
        errorEl.textContent = err.message || 'Something went wrong. Please try again.';
      } else {
        alert(err.message || 'Something went wrong. Please try again.');
      }

      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Listing';
      }
    }
  });
});