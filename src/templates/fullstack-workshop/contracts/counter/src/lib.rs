#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Env, Symbol, symbol_short};

const COUNTER: Symbol = symbol_short!("COUNTER");

#[contracttype]
#[derive(Clone)]
pub struct CountResult {
    pub value: u32,
}

#[contract]
pub struct CounterContract;

#[contractimpl]
impl CounterContract {
    /// Read the current counter value. Free — no signing required.
    pub fn get(env: Env) -> u32 {
        env.storage().instance().get(&COUNTER).unwrap_or(0)
    }

    /// Add 1 to the counter and return the new value.
    pub fn increment(env: Env) -> u32 {
        let current: u32 = env.storage().instance().get(&COUNTER).unwrap_or(0);
        let next = current.checked_add(1).expect("counter overflow");
        env.storage().instance().set(&COUNTER, &next);
        env.storage().instance().extend_ttl(50, 100);
        next
    }

    /// Subtract 1 (saturating at 0) and return the new value.
    pub fn decrement(env: Env) -> u32 {
        let current: u32 = env.storage().instance().get(&COUNTER).unwrap_or(0);
        let next = current.saturating_sub(1);
        env.storage().instance().set(&COUNTER, &next);
        env.storage().instance().extend_ttl(50, 100);
        next
    }

    /// Set the counter back to 0.
    pub fn reset(env: Env) -> u32 {
        env.storage().instance().set(&COUNTER, &0u32);
        env.storage().instance().extend_ttl(50, 100);
        0
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::Env;

    #[test]
    fn counter_round_trip() {
        let env = Env::default();
        let id = env.register(CounterContract, ());
        let client = CounterContractClient::new(&env, &id);

        assert_eq!(client.get(), 0);
        assert_eq!(client.increment(), 1);
        assert_eq!(client.increment(), 2);
        assert_eq!(client.decrement(), 1);
        assert_eq!(client.reset(), 0);
    }
}
