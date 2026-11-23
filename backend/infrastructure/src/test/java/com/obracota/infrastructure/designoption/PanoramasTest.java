package com.obracota.infrastructure.designoption;

import com.obracota.application.airun.port.BudgetReservationPort;
import com.obracota.application.airun.usecase.AiBudget;
import com.obracota.application.common.port.Transactions;
import com.obracota.application.designoption.usecase.Panoramas;
import com.obracota.domain.airun.Consumption;
import com.obracota.domain.assistant.port.service.ImageGenerationPort;
import java.time.Clock;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/** «Panorama 360° con IA»: a 2:1 picture from the scene, under the same budget rule as the options, with a fake image port. */
class PanoramasTest {
    static final class Memory implements BudgetReservationPort {
        final Map<YearMonth, Integer> months = new HashMap<>();
        int locks;
        @Override public void lock() { locks++; }
        @Override public int reserved(YearMonth month) { return months.getOrDefault(month, 0); }
        @Override public void add(YearMonth month, int cents) { months.merge(month, cents, Integer::sum); }
        int total() { return months.values().stream().mapToInt(Integer::intValue).sum(); }
    }

    record Call(String model, byte[] reference, String prompt, int width, int height) {}

    /** Fake provider: records each call; `drawsPanoramas` false stands for the Gemini edit-only port. */
    static final class FakeImages implements ImageGenerationPort {
        final boolean drawsPanoramas;
        final List<Call> calls = new ArrayList<>();
        FakeImages(boolean drawsPanoramas) { this.drawsPanoramas = drawsPanoramas; }
        @Override public Image edit(String model, byte[] jpeg, String prompt) { throw new AssertionError("Not an edit"); }
        @Override public boolean panoramas() { return drawsPanoramas; }
        @Override public Image panorama(String model, byte[] reference, String prompt, int width, int height) {
            calls.add(new Call(model, reference, prompt, width, height));
            return new Image(new byte[] {(byte) 0x89, 'P', 'N', 'G'}, "image/png", new Consumption(null, null, null));
        }
    }

    static final Transactions DIRECT = new Transactions() {
        @Override public <T, E extends Exception> T required(Work<T, E> work) throws E { return work.run(); }
    };
    final UUID project = UUID.randomUUID(), version = UUID.randomUUID(), user = UUID.randomUUID();

    @Test void aFreeProviderDrawsA2To1PanoramaWithTheSceneAndTheViewWithoutReserving() {
        var memory = new Memory();
        var images = new FakeImages(true);
        var checked = new ArrayList<UUID>();
        var panoramas = new Panoramas((p, u, v) -> checked.add(v), images, new AiBudget(memory, 800, Clock.systemUTC()), DIRECT, 0, "flux");
        byte[] view = {1, 2, 3};
        var image = panoramas.generate(project, version, user, "Muestra la escena por la tarde. Sitúa la edificación en la ciudad.", view);
        assertEquals("image/png", image.mime());
        assertEquals(List.of(version), checked);
        var call = images.calls.getFirst();
        assertEquals(2 * call.height(), call.width());
        assertEquals(Panoramas.WIDTH, call.width());
        assertArrayEquals(view, call.reference());
        assertTrue(call.prompt().contains("Equirectangular 360 degree panorama"));
        assertTrue(call.prompt().contains("seamless horizon"));
        assertTrue(call.prompt().contains("attached image"));
        assertTrue(call.prompt().endsWith("Scene: Muestra la escena por la tarde. Sitúa la edificación en la ciudad."));
        assertEquals(0, memory.total());
        assertEquals(1, memory.locks);
    }

    @Test void withoutAReferenceThePromptDoesNotMentionOne() {
        var images = new FakeImages(true);
        new Panoramas((p, u, v) -> {}, images, new AiBudget(new Memory(), 800, Clock.systemUTC()), DIRECT, 0, "flux")
            .generate(project, version, user, "niebla", null);
        assertNull(images.calls.getFirst().reference());
        assertFalse(images.calls.getFirst().prompt().contains("attached image"));
    }

    @Test void aPaidProviderReservesAndStopsWhenTheMonthIsFull() {
        var memory = new Memory();
        var images = new FakeImages(true);
        var panoramas = new Panoramas((p, u, v) -> {}, images, new AiBudget(memory, 100, Clock.systemUTC()), DIRECT, 100, "paid");
        panoramas.generate(project, version, user, "noche", null);
        assertEquals(100, memory.total());
        assertThrows(AiBudget.Exhausted.class, () -> panoramas.generate(project, version, user, "noche", null));
        assertEquals(1, images.calls.size());
        assertEquals(100, memory.total());
    }

    @Test void aProviderWithoutPanoramasIsUnavailableAndReservesNothing() {
        var memory = new Memory();
        var images = new FakeImages(false);
        var panoramas = new Panoramas((p, u, v) -> { throw new AssertionError("No access check needed"); }, images,
            new AiBudget(memory, 800, Clock.systemUTC()), DIRECT, 100, "gemini");
        assertFalse(panoramas.available());
        assertThrows(Panoramas.Unavailable.class, () -> panoramas.generate(project, version, user, "tarde", null));
        assertEquals(0, memory.total());
        assertTrue(images.calls.isEmpty());
    }

    @Test void anotherUsersVersionNeverReachesTheProvider() {
        var images = new FakeImages(true);
        var panoramas = new Panoramas((p, u, v) -> { throw new IllegalStateException("not owner"); }, images,
            new AiBudget(new Memory(), 800, Clock.systemUTC()), DIRECT, 0, "flux");
        assertThrows(IllegalStateException.class, () -> panoramas.generate(project, version, user, "tarde", null));
        assertTrue(images.calls.isEmpty());
        assertThrows(IllegalArgumentException.class, () -> panoramas.generate(project, version, user, " ", null));
    }
}
