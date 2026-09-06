// Centralizes all HTTP Requests
export const API = {
    async checkAutoLogin() {
        const res = await fetch('/get_saved_student');
        return res.ok ? await res.json() : { saved: false };
    },

    async verifyStudent(studentId) {
        const res = await fetch('/verify_student', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ student_id: studentId })
        });
        return res.ok;
    },

    async logout() {
        await fetch('/forget_student', { method: 'POST' });
    },

    async fetchConfig() {
        const res = await fetch('/config');
        return res.ok ? await res.json() : null;
    },

    async exportProject(payload) {
        const res = await fetch('/export_lab', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error(await res.text());
        return await res.json();
    },

    async streamChat(formData, signal) {
        const res = await fetch('/submit', {
            method: 'POST',
            body: formData,
            signal: signal
        });
        if (!res.ok) throw new Error(`Server Error: ${res.status}`);
        return res;
    }
};