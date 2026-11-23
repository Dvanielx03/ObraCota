package com.obracota.infrastructure.modelchange;

import com.obracota.application.agenttools.DesignAgentTools;
import com.obracota.application.modelchange.usecase.ModelChanges;
import com.obracota.application.modelchange.usecase.ModelReading;
import com.obracota.application.modelchange.usecase.PublishModelChange;
import com.obracota.application.modelchange.usecase.VersionPrices;
import com.obracota.application.modelfile.usecase.ProjectFileCatalog;
import com.obracota.application.modelversion.usecase.ProjectVersions;
import com.obracota.domain.modelversion.port.OriginalStorage;
import com.obracota.domain.modelversion.port.VersionRepository;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import java.lang.reflect.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/**
 * J14: what the agent's catalog receives ({@link ModelChanges}, {@link ModelReading}) cannot lead to publishing.
 * They are {@code final} classes, not records, and no public method returns, directly or inside the records it returns,
 * anything that uploads a revision, reads the originals or sets prices. Plain reflection, no Spring.
 */
class AgentReachTest {
    static final Set<Class<?>> PUBLISHING = Set.of(ProjectVersions.class, OriginalStorage.class, VersionRepository.class,
        ProjectFileCatalog.class, PublishModelChange.class, VersionPrices.class);

    @ParameterizedTest
    @ValueSource(classes = {ModelChanges.class, ModelReading.class, DesignAgentTools.class})
    void catalogClassesAreClosed(Class<?> type) {
        assertTrue(Modifier.isFinal(type.getModifiers()), type + " is final");
        assertFalse(type.isRecord(), type + " is not a record");
        for (var field : type.getDeclaredFields()) {
            if (!Modifier.isStatic(field.getModifiers())) assertTrue(Modifier.isPrivate(field.getModifiers()), field + " is private");
            else if (Modifier.isPublic(field.getModifiers())) {
                assertTrue(Modifier.isFinal(field.getModifiers()), field + " is a constant");
                var reached = new HashSet<Class<?>>();
                walk(field.getGenericType(), reached);
                for (var forbidden : PUBLISHING) assertTrue(reached.stream().noneMatch(forbidden::isAssignableFrom), field + " reaches " + forbidden);
            }
        }
    }

    @ParameterizedTest
    @ValueSource(classes = {ModelChanges.class, ModelReading.class, DesignAgentTools.class})
    void noPublicMethodReturnsWhatPublishes(Class<?> type) {
        for (var method : type.getMethods()) {
            if (method.getDeclaringClass() == Object.class) continue;
            var reached = new HashSet<Class<?>>();
            walk(method.getGenericReturnType(), reached);
            for (var forbidden : PUBLISHING)
                assertTrue(reached.stream().noneMatch(forbidden::isAssignableFrom), method + " reaches " + forbidden.getSimpleName());
        }
    }

    @ParameterizedTest
    @ValueSource(classes = {PublishModelChange.class, VersionPrices.class})
    void theWalkWouldNoticeAPublishingType(Class<?> type) {
        var reached = new HashSet<Class<?>>();
        walk(type, reached);
        assertTrue(reached.contains(type));
    }

    /** Every class a value of {@code type} exposes: type arguments, arrays, record components and sealed subtypes. */
    static void walk(Type type, Set<Class<?>> reached) {
        switch (type) {
            case Class<?> raw -> {
                if (raw.isArray()) { walk(raw.getComponentType(), reached); return; }
                if (raw.isPrimitive() || !reached.add(raw)) return;
                if (raw.isRecord()) for (var component : raw.getRecordComponents()) walk(component.getGenericType(), reached);
                if (raw.isSealed()) for (var permitted : raw.getPermittedSubclasses()) walk(permitted, reached);
            }
            case ParameterizedType generic -> {
                walk(generic.getRawType(), reached);
                for (var argument : generic.getActualTypeArguments()) walk(argument, reached);
            }
            case GenericArrayType array -> walk(array.getGenericComponentType(), reached);
            case WildcardType wildcard -> {
                for (var bound : wildcard.getUpperBounds()) walk(bound, reached);
                for (var bound : wildcard.getLowerBounds()) walk(bound, reached);
            }
            case TypeVariable<?> variable -> { for (var bound : variable.getBounds()) walk(bound, reached); }
            default -> { }
        }
    }
}
