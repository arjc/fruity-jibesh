import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getHighScores } from '../../stores/db';
import GameOverModal from '../GameOverModal.svelte';

afterEach(() => {
	cleanup();
});

describe('GameOverModal', () => {
	it('shows the local score and best score without submitting online', async () => {
		vi.mocked(getHighScores).mockResolvedValue([{ id: 1, score: 2000, date: new Date() }]);
		const { getByText } = render(GameOverModal, {
			props: { open: true, score: 1500, onClose: vi.fn() }
		});

		expect(getByText((_, element) => element?.textContent === 'Score: 1,500')).not.toBeNull();
		await waitFor(() =>
			expect(getByText((_, element) => element?.textContent === 'Best: 2,000')).not.toBeNull()
		);
		expect(getHighScores).toHaveBeenCalled();
	});

	it('starts a new game when the button is clicked', async () => {
		const onClose = vi.fn();
		const { getByRole } = render(GameOverModal, {
			props: { open: true, score: 1500, onClose }
		});

		await fireEvent.click(getByRole('button', { name: 'Start New Game' }));
		expect(onClose).toHaveBeenCalled();
	});
});
