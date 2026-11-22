package com.obracota.infrastructure.common.tx;

import com.obracota.application.common.port.Transactions;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * {@link Transactions} on Spring's {@link TransactionTemplate} (propagation {@code REQUIRED}). Any exception, checked or
 * not, rolls the transaction back and reaches the caller as it was thrown: checked ones cross the template wrapped in a
 * private carrier and are unwrapped here.
 */
@Component
public class SpringTransactions implements Transactions {
    private final TransactionTemplate template;

    public SpringTransactions(TransactionTemplate template) { this.template = template; }

    @Override
    public <T, E extends Exception> T required(Work<T, E> work) throws E {
        try {
            return template.execute(status -> {
                try {
                    return work.run();
                } catch (RuntimeException | Error unchecked) {
                    throw unchecked;
                } catch (Exception checked) {
                    throw new Checked(checked);
                }
            });
        } catch (Checked carrier) {
            @SuppressWarnings("unchecked") var cause = (E) carrier.getCause();
            throw cause;
        }
    }

    private static final class Checked extends RuntimeException {
        private Checked(Exception cause) { super(cause); }
    }
}
