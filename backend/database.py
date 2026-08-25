import os
import logging
from neo4j import GraphDatabase, exceptions
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class Neo4jDriver:
    _instance = None

    def __init__(self):
        self.uri = os.getenv("NEO4J_URI")
        self.user = os.getenv("NEO4J_USERNAME")
        self.password = os.getenv("NEO4J_PASSWORD")
        self.driver = None
        self._connect()

    def _connect(self):
        """Initializes the Neo4j driver connection."""
        if not self.uri or not self.user or not self.password:
            logger.error("Database credentials are not fully set in the environment variables.")
            return

        try:
            # We connect to CognoDB using the standard Neo4j driver over the Bolt protocol
            self.driver = GraphDatabase.driver(self.uri, auth=(self.user, self.password))
            # Verify connectivity as explicitly requested in the prompt
            self.driver.verify_connectivity()
            logger.info(f"Successfully connected to CognoDB at {self.uri}")
        except exceptions.ServiceUnavailable as e:
            logger.error(f"Failed to connect to CognoDB (Service Unavailable). Is it running? Error: {e}")
            self.driver = None
        except exceptions.AuthError as e:
            logger.error(f"Failed to connect to CognoDB (Authentication Error). Check credentials. Error: {e}")
            self.driver = None
        except Exception as e:
            logger.error(f"An unexpected error occurred while connecting to CognoDB: {e}")
            self.driver = None

    @classmethod
    def get_instance(cls):
        """Returns the singleton instance of the Neo4jDriver."""
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def get_session(self):
        """Returns a new Neo4j session if connected, otherwise raises an exception."""
        if not self.driver:
            # Graceful error handling for when the database is unreachable
            raise ConnectionError("Database is currently unreachable. Please try again later.")
        return self.driver.session()

    def close(self):
        """Closes the driver connection."""
        if self.driver:
            self.driver.close()
            logger.info("CognoDB connection closed.")

# Instantiate a global instance to be used across the app
db = Neo4jDriver.get_instance()
