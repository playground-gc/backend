import { useState } from 'react';
import { placeOrder } from '../services/api/ordersApi';

/**
 * @file useOrderSubmit.js
 * @description Hook to manage order placement state.
 */

export const useOrderSubmit = () => {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState(null);

    const submit = async (params) => {
        setIsSubmitting(true);
        setError(null);
        const result = await placeOrder(params);
        setIsSubmitting(false);
        if (!result.success) {
            setError(result.error);
        }
        return result;
    };

    return { submit, isSubmitting, error };
};
