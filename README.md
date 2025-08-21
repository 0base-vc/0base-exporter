![Title](0base-exporter.png "Title")

# 0Base Exporter

Extra metrics for Blockchain.


## Metrics

### Tendermint
- ~~**tendermint_address_balance** - Total balance of address~~
- **tendermint_address_available** - Available balance of address
- **tendermint_address_delegated** - Delegated balance of address
- **tendermint_address_unbonding**  - Unbonding balance of address 
- **tendermint_address_rewards** - Rewards of address
- **tendermint_address_commission** - Commission balance of address
- **tendermint_validator_rank** - Your rank of validators
- **tendermint_validator_power_rivals** - Voting power of Rivals
- **tendermint_staking_parameters_max_validator_count** - Limitation of validators count
- **tendermint_gov_proposals_count** - Gov proposals count


### Solana
- **Mainnet**:
  - **solana_address_balance** - Total balance of address
  - **solana_address_available** - Available balance of address
  - **solana_validator_activated_stake** - Your activated stake
  - **solana_validator_active** - Your validator active
  - **solana_validator_commission** - Your validator commission
  - **solana_validator_bonds** - Your validator bonds
  - **solana_validator_last_vote** - Your validator last vote
  - **solana_delegation_sol** - Delegations to validator by source (labels: `validator`, `source`)
  - **solana_pending_activation_sol** - Pending activation stake by source (labels: `validator`, `source`)
  - **solana_pending_deactivation_sol** - Pending deactivation stake by source (labels: `validator`, `source`)
  - **solana_marinade_min_effective_bid_sol** - Minimum effective bid required to receive delegation from Marinade (labels: `validator`)
  - **solana_marinade_my_bid_sol** - Current bid value our validator has set in Marinade (labels: `validator`)
  - **solana_slots_assigned_total** - Total number of leader slots assigned in the current epoch (labels: `validator`, `epoch`)
  - **solana_slots_produced_total** - Number of leader slots successfully produced in the current epoch (labels: `validator`, `epoch`)
  - **solana_slots_skipped_total** - Number of assigned but not produced slots in the current epoch (labels: `validator`, `epoch`)
  - **solana_block_fees_total_sol** - Total transaction fees from blocks we produced (labels: `validator`, `epoch`)
  - **solana_mev_fees_total_sol** - Total MEV-related fees collected (labels: `validator`, `epoch`)
  - **solana_block_fees_median_sol** - Median transaction fees per produced block (labels: `validator`, `epoch`)
  - **solana_block_tips_median_sol** - Median block tips per produced block (labels: `validator`, `epoch`)
- **Testnet**:
  - **solana_address_balance** - Total balance of address
  - **solana_address_available** - Available balance of address
  - **solana_validator_activated_stake** - Your activated stake
  - **solana_validator_active** - Your validator active
  - **solana_validator_commission** - Your validator commission
  - **solana_validator_bonds** - Your validator bonds
  - **solana_validator_last_vote** - Your validator last vote
  - **solana_onboarding_priority** - Validator onboarding priority number

## ENV

| Variable Name                    | Description                                       | Example                                               |
|----------------------------------|---------------------------------------------------|-------------------------------------------------------|
| `PORT`                           | Exporter listening Port                           | `27770`                                               |
| `BLOCKCHAIN`                     | Blockchain to be used in `./availables` directory | `./availables/tendermint.ts`                          |
| `EXISTING_METRICS_URL(Optional)` | The existing metrics URL                          | `http://localhost:26660,http://localhost:26661`       |
| `API_URL`                        | Blockchain API URL                                | `http://localhost:1317`                               |
| `RPC_URL`                        | Blockchain RPC URL                                | `http://localhost:26657`                              |
| `ADDRESS`                        | Your addresses                                    | `akash1n3mhyp9fvcmuu8l0q8qvjy07x0rql8q4jxqcnl`        |
| `VALIDATOR`                      | Your validator address                            | `akashvaloper1n3mhyp9fvcmuu8l0q8qvjy07x0rql8q4cyw7r4` |
| `VOTE`                           | Solana vote accounts (comma-separated)            | `5BAi9YGCipHq4ZcXuen5vagRQqRTVTRszXNqBZC6uBPZ`        |
| `IDENTITY`                       | Solana identity accounts (comma-separated)        | `zeroT6PTAEjipvZuACTh1mbGCqTHgA6i1ped9DcuidX`         |
| `DECIMAL_PLACES(Optional)`       | Decimal Places                                    | `6 or 18`                                             |