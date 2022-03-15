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
- **solana_address_balance** - Total balance of address
- **solana_address_available** - Available balance of address
- **solana_validator_activated_stake** - Your activated stake
- **solana_validator_active** - Your validator active
- **solana_validator_commission** - Your validator commission
- **solana_validator_rank** - Your validator rank
- **solana_validator_root_slot** - Your validator root slot
- **solana_validator_last_vote** - Your validator last vote
- **solana_validators_count** - Validators count

## ENV

| Variable Name                    | Description                                       | Example                                               |
|----------------------------------|---------------------------------------------------|-------------------------------------------------------|
| `PORT`                           | Exporter listening Port                           | `27770`                                               |
| `BLOCKCHAIN`                     | Blockchain to be used in `./availables` directory | `./availables/tendermint.ts`                          |
| `EXISTING_METRICS_URL(Optional)` | The existing metrics URL                          | `http://localhost:26660`                              |
| `API_URL`                        | Blockchain API URL                                | `http://localhost:26657`                              |
| `ADDRESS`                        | Your address                                      | `akash1n3mhyp9fvcmuu8l0q8qvjy07x0rql8q4jxqcnl`        |
| `VALIDATOR`                      | Your validator address                            | `akashvaloper1n3mhyp9fvcmuu8l0q8qvjy07x0rql8q4cyw7r4` |
| `DECIMAL_PLACES(Optional)`       | Decimal Places                                    | `6 or 18`                                             |